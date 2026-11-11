    // ===== 3.2 DOM 与运行时通用工具 =====
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // 拼进 innerHTML 的外部数据（词库、API、页面属性）统一转义。
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[ch]);
    }

    // 快捷键不能劫持输入框里的按键（光标移动、数值步进等）。
    function isEditableKeyTarget(target) {
        return Boolean(target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
    }

    // 页面内轻提示：替代 alert()，不阻塞操作，到时自动消失；duration 为 0 时常驻，由调用方移除。
    function showToast(message, { type = 'info', duration = 3200 } = {}) {
        if (!message || !document.body) return null;
        let root = document.getElementById('nh-toast-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'nh-toast-root';
            root.setAttribute('role', 'status');
            root.setAttribute('aria-live', 'polite');
            document.body.appendChild(root);
        }
        const toast = document.createElement('div');
        toast.className = `nh-toast nh-toast-${type}`;
        toast.textContent = message;
        root.appendChild(toast);
        if (duration > 0) setTimeout(() => toast.remove(), Math.max(1000, duration));
        return toast;
    }

    function queryAll(context, selector) {
        return context && context.querySelectorAll ? Array.from(context.querySelectorAll(selector)) : [];
    }

    function queryOne(context, selector) {
        return context && context.querySelector ? context.querySelector(selector) : null;
    }

    function isUserLoggedIn() {
        const app = window._n_app ?? window.n ?? null;
        if (Array.isArray(app?.options?.blacklisted_tags)) return true;
        return !queryOne(document, '.menu-sign-in a[href="/login/"]');
    }
