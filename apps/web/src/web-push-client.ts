export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function currentPushSubscription(): Promise<
  BrowserPushSubscription | undefined
> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return undefined;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? serializePushSubscription(subscription) : undefined;
}

export async function subscribeWebPush(
  publicKey: string,
): Promise<BrowserPushSubscription> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push messaging is not supported.");
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  await registration.update();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(publicKey),
    }));
  return serializePushSubscription(subscription);
}

export async function unsubscribeWebPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

function serializePushSubscription(
  subscription: PushSubscription,
): BrowserPushSubscription {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error("Push subscription keys are missing.");
  }
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(
    (value + padding).replaceAll("-", "+").replaceAll("_", "/"),
  );
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
