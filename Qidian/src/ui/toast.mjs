const TOAST_DURATION = 6000;

// 同一时间只显示一条，带一个操作按钮，超时自动消失
export const Toast = {
    el: null,
    timer: 0,

    show: (message, actionLabel, onAction) => {
        Toast.hide();
        const el = document.createElement("div");
        el.className = "qd-toast";
        const text = document.createElement("span");
        text.className = "qd-toast-text";
        text.textContent = message;
        const action = document.createElement("button");
        action.type = "button";
        action.className = "qd-toast-action";
        action.textContent = actionLabel;
        action.onclick = () => {
            Toast.hide();
            onAction();
        };
        el.append(text, action);
        document.body.appendChild(el);
        Toast.el = el;
        Toast.timer = setTimeout(Toast.hide, TOAST_DURATION);
    },
    hide: () => {
        clearTimeout(Toast.timer);
        if (Toast.el) Toast.el.remove();
        Toast.el = null;
    }
};
