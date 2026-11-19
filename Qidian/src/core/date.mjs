export const pad = (n) => String(n).padStart(2, "0");

export function formatDate(timestamp) {
    if (!timestamp) return "历史记录";
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
