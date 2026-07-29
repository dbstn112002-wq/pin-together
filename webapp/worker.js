import { buildPushPayload } from '@block65/webcrypto-web-push';

const defaultPreferences = { pin:true, comment:true, reply:true, message:true, route:true, invite:true, reaction:true, favorite:false, location:false, checklist:true, poll:true, announcement:true, system:true };
const preferenceByKind = { pin:'pin', comment:'comment', message:'message', route:'route', member:'invite', invite:'invite', reaction:'reaction', favorite:'favorite', location:'location', checklist:'checklist', poll:'poll' };
const notificationTitles = { pin:'핀 알림', comment:'댓글', message:'채팅', route:'경로', member:'참가자', invite:'초대', reaction:'반응', favorite:'즐겨찾기', location:'위치 공유', checklist:'체크리스트', poll:'투표', system:'시스템 알림' };
// Push begins from this production activation point; older in-app history must never be replayed.
const PUSH_ENABLED_AT = new Date('2026-07-28T09:46:00.000Z');
const DEPLOYMENT_PUSH_MAX_AGE_MS = 10 * 60 * 1000;
const deploymentMarker = body => /^\[배포:[^\]]+\]\n/.test(body || '');
function deploymentKey(value='') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
const announcementMarker = body => /^\[공지\]\n/.test(body || '') || String(body || '').startsWith('공지: ');
function visibleNotificationBody(body, kind) {
  const text = String(body || '').replace(/^\[배포:[^\]]+\]\n/, '').replace(/^\[공지\]\n/, '').replace(/^공지:\s*/, '').replace(/^([^:\n]+):\s*/, '$1 : ');
  const actorPrefix = '(^.+?:\\s*)';
  if (kind === 'message') return text.replace(new RegExp(`${actorPrefix}채팅:\\s*`), '$1');
  if (kind === 'pin') return text.replace(new RegExp(`${actorPrefix}(?:새 핀|핀 (?:추가|수정|삭제)):\\s*`), '$1');
  if (kind === 'comment' || kind === 'reply') return text.replace(new RegExp(`${actorPrefix}(「[^」]+」에 )?댓글:\\s*`), '$1$2');
  if (kind === 'route') return text.replace(new RegExp(`${actorPrefix}(?:새 경로|경로 (?:변경|삭제)):\\s*`), '$1');
  return text;
}

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
    method:'PATCH', headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' }, body:JSON.stringify({ push_sent_at:new Date().toISOString(), push_claimed_at:null })
  });
}
async function releaseClaim(env, notificationId) {
  await supabase(env, `notifications?id=eq.${notificationId}&push_sent_at=is.null`, {
    method:'PATCH', headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' }, body:JSON.stringify({ push_claimed_at:null })
  });
}
async function claimNotification(env, notificationId) {
  const retryBefore = encodeURIComponent(new Date(Date.now() - 15 * 60 * 1000).toISOString());
  const rows = await supabase(env, `notifications?id=eq.${notificationId}&push_sent_at=is.null&or=(push_claimed_at.is.null,push_claimed_at.lt.${retryBefore})`, {
    method:'PATCH', headers:{ 'Content-Type':'application/json', Prefer:'return=representation' }, body:JSON.stringify({ push_claimed_at:new Date().toISOString() })
  });
  return rows?.[0] || null;
}
async function sendNotification(env, notification, { retry=false }={}) {
  if (new Date(notification.created_at) < PUSH_ENABLED_AT) { await markProcessed(env, notification.id); return 'old'; }
  if (deploymentMarker(notification.body) && Date.now() - new Date(notification.created_at).getTime() > DEPLOYMENT_PUSH_MAX_AGE_MS) { await markProcessed(env, notification.id); return 'expired'; }
  const preferenceRows = await supabase(env, `notification_preferences?user_id=eq.${notification.user_id}&select=*`);
  const preferences = { ...defaultPreferences, ...(preferenceRows[0] || {}) };
  const preference = notification.kind === 'system' && announcementMarker(notification.body) ? 'announcement' : (preferenceByKind[notification.kind] || 'system');
  if (!preferences[preference]) { await markProcessed(env, notification.id); return 'disabled'; }

  const subscriptions = await supabase(env, `push_subscriptions?user_id=eq.${notification.user_id}&select=endpoint,p256dh,auth,created_at`);
  // Do not replay notifications that existed before this device opted into push.
  const activeSubscriptions = subscriptions.filter(subscription => new Date(subscription.created_at) <= new Date(notification.created_at));
  if (!activeSubscriptions.length) { await markProcessed(env, notification.id); return 'no_subscription'; }

  const isDeploymentUpdate = notification.kind === 'system' && deploymentMarker(notification.body);
  const notificationTitle = notification.kind === 'system' && announcementMarker(notification.body) ? '공지' : (notification.kind === 'system' && deploymentMarker(notification.body) ? '업데이트' : (notificationTitles[notification.kind] || '알림'));
  const notificationBody = visibleNotificationBody(notification.body, notification.kind);
  const payload = JSON.stringify({
    title:`핀투게더 · ${notificationTitle}${retry ? ' · 재발송' : ''}`,
    body:retry ? `재발송 알림\n${notificationBody}` : notificationBody,
    tag:isDeploymentUpdate ? 'deployment-update' : `notification-${notification.id}`,
    deployment:isDeploymentUpdate,
    createdAt:notification.created_at,
    url:`/?notification=${encodeURIComponent(notification.id)}`
  });
  const vapid = { subject:env.VAPID_SUBJECT, publicKey:env.VAPID_PUBLIC_KEY, privateKey:env.VAPID_PRIVATE_KEY };
  const results = await Promise.all(activeSubscriptions.map(async subscription => {
    const request = await buildPushPayload({ data:payload, options:isDeploymentUpdate ? { ttl:60 } : { ttl:300 } }, {
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
  if (results.every(Boolean)) { await markProcessed(env, notification.id); return 'sent'; }
  return 'failed';
}
async function processPendingPushes(env) {
  if (!env.SUPABASE_SECRET_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;
  const retryBefore = encodeURIComponent(new Date(Date.now() - 15 * 60 * 1000).toISOString());
  const notifications = await supabase(env, `notifications?select=id&push_sent_at=is.null&or=(push_claimed_at.is.null,push_claimed_at.lt.${retryBefore})&order=created_at.asc&limit=50`);
  for (const item of notifications) {
    const notification = await claimNotification(env, item.id);
    if (!notification) continue;
    try { await sendNotification(env, notification, { retry:true }); }
    catch (error) { await releaseClaim(env, notification.id); console.error('Push delivery failed', notification.id, error.message); }
  }
}
async function sendImmediatePush(request, env) {
  const { notification_id: notificationId } = await request.json().catch(() => ({}));
  if (!notificationId || typeof notificationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) return new Response('Invalid notification', { status:400 });
  const notification = await claimNotification(env, notificationId);
  if (!notification) return new Response(null, { status:204 });
  try { await sendNotification(env, notification); return new Response(null, { status:204 }); }
  catch (error) { await releaseClaim(env, notificationId); console.error('Immediate push failed', notificationId, error.message); return new Response('Push failed', { status:502 }); }
}
async function deliverCreatedNotifications(env, rows=[]) {
  const outcomes = await Promise.all(rows.map(async row => {
    // System announcements must not wait behind the asynchronous database webhook.
    // They share the same notification ID/tag, so duplicate transport attempts are collapsed by the client.
    try { return await sendNotification(env, row); }
    catch (error) { console.error('Direct push delivery failed', row.id, error.message); return `failed:${error.message}`; }
  }));
  return outcomes.reduce((summary, outcome) => ({ ...summary, [outcome]:(summary[outcome] || 0) + 1 }), {});
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
  const { body, spaceId } = requestBody;
  if (!requestBody.announcement && !admins.includes(user.email.toLowerCase())) return new Response('Forbidden', { status:403 });
  if (!body || typeof body !== 'string' || body.trim().length > 500) return new Response('Invalid update text', { status:400 });
  if (requestBody.announcement && (!spaceId || typeof spaceId !== 'string')) return new Response('Space is required', { status:400 });
  const members = requestBody.announcement ? await supabase(env, `space_members?space_id=eq.${encodeURIComponent(spaceId)}&select=user_id`) : null;
  if (requestBody.announcement && !members.some(member => member.user_id === user.id)) return new Response('Forbidden', { status:403 });
  const profiles = requestBody.announcement ? members.map(member => ({ id:member.user_id })) : await supabase(env, 'profiles?select=id');
  const preferences = await supabase(env, 'notification_preferences?select=user_id,announcement,system');
  const preferenceName = requestBody.announcement ? 'announcement' : 'system';
  const optedOut = new Set(preferences.filter(row => row[preferenceName] === false).map(row => row.user_id));
  const actorRows = requestBody.announcement ? await supabase(env, `profiles?id=eq.${user.id}&select=nickname&limit=1`) : [];
  const actorName = actorRows[0]?.nickname || '참여자';
  const content = requestBody.announcement ? `[공지]\n${actorName}: ${body.trim()}` : body.trim();
  if (requestBody.announcement) await supabase(env, `notifications?kind=eq.system&space_id=eq.${encodeURIComponent(spaceId)}&is_active_announcement=eq.true`, { method:'PATCH', headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' }, body:JSON.stringify({ is_active_announcement:false }) });
  const rows = profiles.filter(profile => !optedOut.has(profile.id)).map(profile => ({ user_id:profile.id, space_id:requestBody.announcement ? spaceId : null, kind:'system', body:content, is_active_announcement:Boolean(requestBody.announcement) }));
  if (rows.length) {
    const created = await supabase(env, 'notifications', { method:'POST', headers:{ 'Content-Type':'application/json', Prefer:'return=representation' }, body:JSON.stringify(rows) });
    await deliverCreatedNotifications(env, created);
  }
  return Response.json({ delivered:rows.length });
}
async function announceCurrentDeployment(env) {
  if (!env.SUPABASE_SECRET_KEY) return {};
  const releaseText = env.RELEASE_ANNOUNCEMENT?.trim() || '새 업데이트가 배포되었습니다. 변경 내용을 확인해 주세요.';
  const releaseId = deploymentKey(releaseText);
  const body = `[배포:${releaseId}]\n${releaseText}`;
  const markerFilter = encodeURIComponent(`[배포:${releaseId}]%`);
  const existing = await supabase(env, `notifications?kind=eq.system&body=like.${markerFilter}&select=id&limit=1`);
  if (existing.length) {
    const pending = await supabase(env, `notifications?kind=eq.system&body=like.${markerFilter}&push_sent_at=is.null&select=*&limit=50`);
    return pending.length ? await deliverCreatedNotifications(env, pending) : { existing:existing.length };
  }
  const profiles = await supabase(env, 'profiles?select=id');
  const preferences = await supabase(env, 'notification_preferences?select=user_id,system');
  const optedOut = new Set(preferences.filter(row => row.system === false).map(row => row.user_id));
  const rows = profiles.filter(profile => !optedOut.has(profile.id)).map(profile => ({ user_id:profile.id, kind:'system', body }));
  if (rows.length) {
    const created = await supabase(env, 'notifications', { method:'POST', headers:{ 'Content-Type':'application/json', Prefer:'return=representation' }, body:JSON.stringify(rows) });
    return await deliverCreatedNotifications(env, created);
  }
  return {};
}

async function triggerDeploymentNotification(env, expectedReleaseId='') {
  const releaseText = env.RELEASE_ANNOUNCEMENT?.trim() || '새 업데이트가 배포되었습니다. 변경 내용을 확인해 주세요.';
  const releaseId = deploymentKey(releaseText);
  if (expectedReleaseId && expectedReleaseId !== releaseId) return Response.json({ releaseId, ready:false }, { status:409 });
  const delivery = await announceCurrentDeployment(env);
  return Response.json({ releaseId, releaseText, ready:true, delivery:delivery || {} });
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/internal/immediate-push' && request.method === 'POST') return sendImmediatePush(request, env);
    if (new URL(request.url).pathname === '/internal/deployment-notification' && request.method === 'POST') return triggerDeploymentNotification(env);
    if (new URL(request.url).pathname === '/internal/deployment-notification/v2' && request.method === 'POST') return triggerDeploymentNotification(env, new URL(request.url).searchParams.get('expected') || '');
    if (new URL(request.url).pathname === '/admin/release-notification' && request.method === 'POST') return sendReleaseNotification(request, env);
    return env.ASSETS.fetch(request);
  },
  scheduled(event, env, context) {
    context.waitUntil(Promise.allSettled([
      processPendingPushes(env),
      purgeExpiredSpaces(env)
    ]).then(results => results.forEach(result => {
      if (result.status === 'rejected') console.error('Scheduled task failed', result.reason?.message || result.reason);
    })));
  }
};
