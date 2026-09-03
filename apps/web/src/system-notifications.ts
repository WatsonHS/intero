export interface SystemNotificationInput {
  title: string;
  body?: string;
  tag: string;
  data?: {
    threadId?: string;
    itemId?: string;
  };
  onOpen: () => void;
}

export function presentSystemNotification(
  input: SystemNotificationInput,
): boolean {
  const desktop = window.interoDesktop;
  if (desktop?.notify) {
    void desktop.notify({
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
      tag: input.tag,
      ...(input.data?.threadId ? { threadId: input.data.threadId } : {}),
      ...(input.data?.itemId ? { itemId: input.data.itemId } : {}),
    });
    return true;
  }
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  try {
    const notification = new Notification(input.title, {
      ...(input.body ? { body: input.body } : {}),
      tag: input.tag,
      data: input.data,
    });
    notification.onclick = () => {
      input.onOpen();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
