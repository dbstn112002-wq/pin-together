import { buildPushPayload } from '@block65/webcrypto-web-push';

const defaultPreferences = { pin:true, comment:true, reply:true, message:true, route:true, invite:true, reaction:true, favorite:false, location:false, announcement:true, system:true };
const preferenceByKind = { pin:'pin', comment:'comment', message:'message', route:'route', member:'invite', invite:'invite', reaction:'reaction', favorite:'favorite', location:'location' };
const notificationTitles = { pin:'핀 알림', comment:'댓글', message:'채팅', route:'경로', member:'참가자', invite:'초대', reaction:'반응', favorite:'즐겨찾기', location:'위치 공유', system:'시스템 알림' };
// Push begins from this production activation point; older in-app history must never be replayed.
const PUSH_ENABLED_AT = new Date('2026-07-28T09:46:00.000Z');
const deploymentMarker = body => /^\[배포:[^\]]+\]\n/.test(body || '');
const visibleNotificationBody = body => String(body || '').replace(/^\[배포:[^\]]+\]\n/, '');

function restUrl(env, path) { return `${env.SUPABASE_REST_URL.replace(/\/$/, '')}/${path}`; }
async function supabase(env, path, options={}) {
  const response = await fetch(restUrl(env, path), {
    ...options,
    headers:{ apikey:env.SUPABASE_SECRET_KEY, ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function markProcessed(env, notificationId) {
  await supabase(env, `notifications?id=eq.${notificationId}`, {
    method:'PATCH', headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' }, body:JSON.stringify({ push_sent_at:new Date().toISOString() })
  });
}
async function sendNotification(env, notification) {
  if (new Date(notification.created_at) < PUSH_ENABLED_AT) return markProcessed(env, notification.id);
  const preferenceRows = await supabase(env, `notification_preferences?user_id=eq.${notification.user_id}&select=*`);
  const preferences = { ...defaultPreferences, ...(preferenceRows[0] || {}) };
  const preference = notification.kind === 'system' && notification.body.startsWith('공지: ') ? 'announcement' : (preferenceByKind[notification.kind] || 'system');
  if (!preferences[preference]) return markProcessed(env, notification.id);

  const subscriptions = await supabase(env, `push_subscriptions?user_id=eq.${notification.user_id}&select=endpoint,p256dh,auth,created_at`);
  // Do not replay notifications that existed before this device opted into push.
  const activeSubscriptions = subscriptions.filter(subscription => new Date(subscription.created_at) <= new Date(notification.created_at));
  if (!activeSubscriptions.length) return markProcessed(env, notification.id);

  const payload = JSON.stringify({
    title:`핀투게더 · ${notification.kind === 'system' && notification.body.startsWith('공지: ') ? '공지' : (notification.kind === 'system' && deploymentMarker(notification.body) ? '업데이트' : (notificationTitles[notification.kind] || '알림'))}`,
    body:visibleNotificationBody(notification.body),
    tag:`notification-${notification.id}`,
    url:`/?notification=${encodeURIComponent(notification.id)}`
  });
  const vapid = { subject:env.VAPID_SUBJECT, publicKey:env.VAPID_PUBLIC_KEY, privateKey:env.VAPID_PRIVATE_KEY };
  const results = await Promise.all(activeSubscriptions.map(async subscription => {
    const request = await buildPushPayload({ data:payload, options:{ ttl:300 } }, {
      endpoint:subscription.endpoint, expirationTime:null, keys:{ p256dh:subscription.p256dh, auth:subscription.auth }
    }, vapid);
    const response = await fetch(subscription.endpoint, request);
    if (response.status === 404 || response.status === 410) {
      await supabase(env, `push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
      return true;
    }
    if (!response.ok) throw new Error(`Push service request failed: ${response.status}`);
    return true;
  }));
  if (results.every(Boolean)) await markProcessed(env, notification.id);
}
async function processPendingPushes(env) {
  if (!env.SUPABASE_SECRET_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;
  const notifications = await supabase(env, 'notifications?select=id,user_id,space_id,kind,body,pin_id,created_at&push_sent_at=is.null&order=created_at.asc&limit=50');
  for (const notification of notifications) {
    try { await sendNotification(env, notification); }
    catch (error) { console.error('Push delivery failed', notification.id, error.message); }
  }
}
async function purgeExpiredSpaces(env) {
  if (!env.SUPABASE_SECRET_KEY) return;
  const now = encodeURIComponent(new Date().toISOString());
  const spaces = await supabase(env, `spaces?select=id&deleted_at=not.is.null&purge_at=lte.${now}&limit=50`);
  for (const space of spaces) {
    await supabase(env, `spaces?id=eq.${space.id}`, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
  }
}
async function sendReleaseNotification(request, env) {
  const token = request.headers.get('Authorization') || '';
  const authUrl = env.SUPABASE_REST_URL.replace(/\/rest\/v1\/?$/, '/auth/v1/user');
  const userResponse = await fetch(authUrl, { headers:{ apikey:env.SUPABASE_SECRET_KEY, Authorization:token } });
  const user = userResponse.ok ? await userResponse.json() : null;
  const admins = (env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase());
  if (!user?.email) return new Response('Unauthorized', { status:401 });
  const requestBody = await request.json().catch(() => ({}));
  const { body } = requestBody;
  if (!requestBody.announcement && !admins.includes(user.email.toLowerCase())) return new Response('Forbidden', { status:403 });
  if (!body || typeof body !== 'string' || body.trim().length > 500) return new Response('Invalid update text', { status:400 });
  const profiles = await supabase(env, 'profiles?select=id');
  const preferences = await supabase(env, 'notification_preferences?select=user_id,announcement,system');
  const preferenceName = requestBody.announcement ? 'announcement' : 'system';
  const optedOut = new Set(preferences.filter(row => row[preferenceName] === false).map(row => row.user_id));
  const content = requestBody.announcement ? `공지: ${body.trim()}` : body.trim();
  if (requestBody.announcement) await supabase(env, 'notifications?kind=eq.system&is_active_announcement=eq.true', { method:'PATCH', headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' }, body:JSON.stringify({ is_active_announcement:false }) });
  const rows = profiles.filter(profile => !optedOut.has(profile.id)).map(profile => ({ user_id:profile.id, kind:'system', body:content, is_active_announcement:Boolean(requestBody.announcement) }));
  if (rows.length) await supabase(env, 'notifications', { method:'POST', headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' }, body:JSON.stringify(rows) });
  return Response.json({ delivered:rows.length });
}
async function announceCurrentDeployment(env) {
  const versionId = env.CF_VERSION_METADATA?.id;
  if (!versionId || !env.SUPABASE_SECRET_KEY) return;
  const body = `[배포:${versionId}]\n${env.RELEASE_ANNOUNCEMENT?.trim() || '새 업데이트가 배포되었습니다. 변경 내용을 확인해 주세요.'}`;
  const existing = await supabase(env, `notifications?kind=eq.system&body=eq.${encodeURIComponent(body)}&select=id&limit=1`);
  if (existing.length) return;
  const profiles = await supabase(env, 'profiles?select=id');
  const preferences = await supabase(env, 'notification_preferences?select=user_id,system');
  const optedOut = new Set(preferences.filter(row => row.system === false).map(row => row.user_id));
  const rows = profiles.filter(profile => !optedOut.has(profile.id)).map(profile => ({ user_id:profile.id, kind:'system', body }));
  if (rows.length) await supabase(env, 'notifications', { method:'POST', headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' }, body:JSON.stringify(rows) });
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/admin/release-notification' && request.method === 'POST') return sendReleaseNotification(request, env);
    return env.ASSETS.fetch(request);
  },
  scheduled(event, env, context) {
    context.waitUntil(Promise.allSettled([
    announceCurrentDeployment(env),
      processPendingPushes(env),
      purgeExpiredSpaces(env)
    ]).then(results => results.forEach(result => {
      if (result.status === 'rejected') console.error('Scheduled task failed', result.reason?.message || result.reason);
    })));
  }
};
