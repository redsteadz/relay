export async function scheduleEarlierAlarm(
  storage: DurableObjectStorage,
  scheduledTime: number,
): Promise<void> {
  const current = await storage.getAlarm();
  if (current === null || scheduledTime < current) await storage.setAlarm(scheduledTime);
}
