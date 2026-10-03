const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function time(value: string) {
  return dateFormat.format(new Date(value));
}
export function localInput(value = new Date().toISOString()) {
  return new Date(new Date(value).getTime() + 8 * 3600_000)
    .toISOString()
    .slice(0, 16);
}
export function utc(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}
