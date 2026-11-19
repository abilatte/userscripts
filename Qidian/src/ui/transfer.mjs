import { normalizeBlocklist } from "../core/blocklist.mjs";
import { pad } from "../core/date.mjs";
import { Storage } from "../core/storage.mjs";

export const Transfer = {
    exportFile: () => {
        const blob = new Blob([JSON.stringify(Storage.getMap(), null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const d = new Date();
        const a = document.createElement("a");
        a.href = url;
        a.download = `qidian_blocklist_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },
    importFile: () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = () => {
            const file = input.files[0];
            if (file) file.text().then(Transfer.importText, (err) => {
                console.error("QidianBlocker Import Error:", err);
                alert("文件读取失败，请重新选择文件。");
            }).catch(Storage.reportError);
        };
        input.click();
    },
    importText: async (text) => {
        let raw;
        try {
            raw = JSON.parse(text);
        } catch (err) {
            console.error("QidianBlocker Import Error:", err);
            alert("导入失败：文件不是有效的 JSON。");
            return;
        }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            alert("导入失败：数据格式应为 { 书籍ID: { title, time } }。");
            return;
        }

        const { map, skipped } = normalizeBlocklist(raw);
        if (Object.keys(map).length === 0) {
            alert(`未发现有效记录，已跳过 ${skipped} 条。`);
            return;
        }
        const { added, overwritten } = await Storage.merge(map);
        alert(`导入完成：新增 ${added} 条，覆盖 ${overwritten} 条，跳过 ${skipped} 条无效记录。`);
    }
};
