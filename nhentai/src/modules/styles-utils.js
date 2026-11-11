    // ===== 3.6 标签命名空间辅助与样式注入 =====
    function detectTagNamespaceFromText(text = '') {
        const normalizedText = String(text).toLowerCase();
        if (normalizedText.includes('parodies') || normalizedText.includes('原作')) return 'parody';
        if (normalizedText.includes('characters') || normalizedText.includes('角色')) return 'character';
        if (normalizedText.includes('artists') || normalizedText.includes('作者')) return 'artist';
        if (normalizedText.includes('groups') || normalizedText.includes('社团')) return 'group';
        if (normalizedText.includes('languages') || normalizedText.includes('语言')) return 'language';
        return 'tag';
    }

    function detectTagNamespaceFromHref(href = '', fallbackNs = null) {
        if (fallbackNs && !href.includes('/g/')) return fallbackNs;
        if (href.includes('/artist/') || href.includes('/artists/')) return 'artist';
        if (href.includes('/character/') || href.includes('/characters/')) return 'character';
        if (href.includes('/parody/') || href.includes('/parodies/')) return 'parody';
        if (href.includes('/group/') || href.includes('/groups/')) return 'group';
        if (href.includes('/language/') || href.includes('/languages/')) return 'language';
        if (href.includes('/category/') || href.includes('/categories/')) return 'tag';
        if (href.includes('/tag/') || href.includes('/tags/')) return 'tag';
        return fallbackNs || 'tag';
    }

    const Styles = {
        base: `
        :root {
            --nh-color-bg: #1f1f1f;
            --nh-color-bg-elevated: #252525;
            --nh-color-bg-muted: #2b2b2b;
            --nh-color-bg-strong: #222;
            --nh-color-bg-hover: #2f2f2f;
            --nh-color-border: #333;
            --nh-color-border-strong: #3e3e3e;
            --nh-color-text: #f1f1f1;
            --nh-color-text-soft: #ccc;
            --nh-color-text-muted: #aaa;
            --nh-color-text-subtle: #888;
            --nh-color-accent: #ed2553;
            --nh-color-accent-hover: #c01c42;
            --nh-color-accent-soft: rgba(237, 37, 83, 0.1);
            --nh-color-danger: #d92020;
            --nh-focus-ring: rgba(237, 37, 83, 0.45);
            --nh-shadow-sm: 0 4px 8px rgba(0,0,0,0.5);
            --nh-shadow-md: 0 5px 15px rgba(0,0,0,0.5);
            --nh-shadow-lg: 0 10px 25px rgba(0,0,0,0.8);
            --nh-radius-sm: 4px;
            --nh-radius-md: 6px;
            --nh-radius-lg: 8px;
            --nh-font-size-sm: 12px;
            --nh-font-size-md: 13px;
            --nh-font-size-lg: 14px;
            --nh-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }

        .nh-helper-suggestion-box { position: absolute; background: var(--nh-color-bg); border: 1px solid var(--nh-color-border); border-top: none; font-size: var(--nh-font-size-lg); color: var(--nh-color-text); z-index: 1001; width: 100%; max-height: 300px; overflow-y: auto; box-shadow: 0 8px 16px rgba(0,0,0,0.6); border-radius: 0 0 5px 5px; }
        .nh-helper-suggestion-box::-webkit-scrollbar { width: 6px; }
        .nh-helper-suggestion-box::-webkit-scrollbar-thumb { background: var(--nh-color-border); border-radius: 3px; }
        form[action="/search/"].nh-helper-cn-suggestion-active > [role="listbox"] { display: none !important; }
        .nh-helper-suggestion-item { padding: 6px 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--nh-color-bg-elevated); display: flex; align-items: center; transition: background-color 0.1s; }
        .nh-helper-suggestion-item:hover, .nh-helper-suggestion-item.active { background-color: var(--nh-color-accent); color: #fff; }
        body.nh-shift-pressed .nh-helper-suggestion-item:hover, body.nh-shift-pressed .nh-helper-suggestion-item.active { background-color: var(--nh-color-danger); }
        body.nh-shift-pressed .nh-helper-suggestion-item:hover::after { content: " (排除)"; font-size: 10px; margin-left: auto; opacity: 0.8; }
        .nh-helper-loading { padding: 10px; text-align: center; color: var(--nh-color-text-subtle); font-style: italic; }
        .nh-helper-suggestion-item .type-badge { display: inline-block; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: var(--nh-radius-sm); background: var(--nh-color-border); color: var(--nh-color-text-muted); margin-right: 10px; width: 70px; text-align: center; text-transform: uppercase; flex-shrink: 0; }
        .nh-helper-suggestion-item:hover .type-badge, .nh-helper-suggestion-item.active .type-badge { background: rgba(0,0,0,0.2); color: #fff; }
        .nh-helper-suggestion-item .content-wrapper { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; }
        .nh-helper-suggestion-item .meta { font-size: var(--nh-font-size-sm); opacity: 0.6; margin-left: 8px; }
        .nh-helper-suggestion-item:hover .meta { opacity: 0.9; color: #eee; }

        #nh-helper-quick-tags { display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 1000; background-color: var(--nh-color-bg); border: 1px solid var(--nh-color-border); border-top: none; box-shadow: var(--nh-shadow-sm); border-radius: 0 0 5px 5px; gap: 8px; flex-wrap: wrap; padding: 8px; animation: fadeIn 0.2s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        .nh-helper-tag-btn { padding: 5px 12px; font-size: var(--nh-font-size-sm); background: var(--nh-color-bg-muted); border: 1px solid var(--nh-color-border-strong); border-radius: 15px; cursor: pointer; color: #bbb; transition: all 0.2s; }
        .nh-helper-tag-btn:hover { background: var(--nh-color-accent); border-color: var(--nh-color-accent); color: #fff; }
        body.nh-shift-pressed .nh-helper-tag-btn:hover { background: var(--nh-color-danger); border-color: var(--nh-color-danger); }
        body.nh-shift-pressed .nh-helper-tag-btn:hover::after { content: " (-)"; }

        .nh-translated-tag { font-size: 90%; color: var(--nh-color-text-muted); margin-left: 4px; }
        .nh-original-tag { font-size: 90%; color: var(--nh-color-text-muted); margin-left: 4px; }
        .nh-inline-subtag { font-size: 85%; opacity: 0.7; margin-left: 2px; }
        .tag:hover .nh-translated-tag, .tag:hover .nh-original-tag { color: rgba(255,255,255,0.8); }
        #nh-db-status { font-size: var(--nh-font-size-sm); color: var(--nh-color-accent); margin-left: 10px; display: inline-block; }
        #nh-toast-root { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 10100; display: flex; flex-direction: column; align-items: center; gap: 8px; width: max-content; max-width: calc(100vw - 32px); pointer-events: none; }
        .nh-toast { padding: 9px 16px; border-radius: var(--nh-radius-md); background: rgba(20,20,20,0.94); color: var(--nh-color-text); border: 1px solid var(--nh-color-border-strong); box-shadow: var(--nh-shadow-md); font-family: var(--nh-font-family); font-size: var(--nh-font-size-md); line-height: 1.4; animation: fadeIn 0.2s ease-out; }
        .nh-toast-error { color: #ffd3dd; border-color: rgba(255, 99, 132, 0.55); }

        /* ===== Settings modal (preference sheet) ===== */
        #nh-settings-overlay {
            position: fixed; inset: 0; z-index: 9999;
            display: flex; justify-content: center; align-items: center;
            padding: 20px 12px;
            background:
                radial-gradient(1200px 500px at 50% -10%, rgba(237, 37, 83, 0.18), transparent 55%),
                rgba(8, 8, 10, 0.72);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            animation: nh-settings-fade-in 0.16s ease-out;
        }
        @keyframes nh-settings-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        #nh-settings-modal {
            --nh-settings-pad-x: 20px;
            width: min(96vw, 560px);
            max-height: min(88vh, 760px);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-sizing: border-box;
            color: var(--nh-color-text);
            font-family: var(--nh-font-family);
            border-radius: 18px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background:
                linear-gradient(180deg, rgba(42, 28, 34, 0.55) 0%, rgba(24, 24, 26, 0) 120px),
                linear-gradient(180deg, #1c1c1f 0%, #161618 100%);
            box-shadow:
                0 0 0 1px rgba(237, 37, 83, 0.08),
                0 28px 80px rgba(0, 0, 0, 0.55),
                0 2px 0 rgba(255, 255, 255, 0.04) inset;
            animation: nh-settings-pop-in 0.18s ease-out;
        }
        @keyframes nh-settings-pop-in {
            from { opacity: 0; transform: translateY(10px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
            #nh-settings-overlay,
            #nh-settings-modal { animation: none; }
            .nh-tab-content { animation: none !important; }
        }
        #nh-settings-modal h3 {
            margin: 0;
            border: none;
            color: #fff;
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.01em;
            line-height: 1.25;
        }
        .nh-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            flex: 0 0 auto;
            padding: 18px var(--nh-settings-pad-x) 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent);
        }
        .nh-modal-header-main {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }
        .nh-modal-eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: #ff7a9a;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .nh-modal-eyebrow::before {
            content: "";
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--nh-color-accent);
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.22);
        }
        .nh-modal-header .version {
            font-size: 11px;
            font-weight: 600;
            color: #8a8a92;
            font-variant-numeric: tabular-nums;
            padding: 3px 8px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .nh-modal-tools { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
        .nh-lang-switch-btn {
            padding: 5px 10px !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            background: rgba(255, 255, 255, 0.05) !important;
            color: #ddd !important;
        }
        .nh-lang-switch-btn:hover {
            background: rgba(237, 37, 83, 0.16) !important;
            border-color: rgba(237, 37, 83, 0.35) !important;
            color: #fff !important;
        }

        .nh-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            flex: 0 0 auto;
            margin: 0;
            padding: 12px var(--nh-settings-pad-x) 10px;
            overflow: visible;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            background: rgba(0, 0, 0, 0.12);
        }
        .nh-tab-btn {
            flex: 1 1 calc(33.333% - 6px);
            min-width: 0;
            max-width: 100%;
            padding: 7px 8px;
            border: 1px solid transparent;
            border-radius: 999px;
            background: transparent;
            color: #9a9aa3;
            cursor: pointer;
            font-size: 12px;
            font-weight: 700;
            line-height: 1.2;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .nh-tab-btn:hover {
            color: #f0f0f3;
            background: rgba(255, 255, 255, 0.05);
        }
        .nh-tab-btn.active {
            color: #fff;
            background: linear-gradient(180deg, rgba(237, 37, 83, 0.95), rgba(196, 24, 64, 0.95));
            border-color: rgba(255, 255, 255, 0.08);
            box-shadow: 0 6px 16px rgba(237, 37, 83, 0.28);
        }
        .nh-tab-btn:focus-visible {
            outline: 2px solid var(--nh-color-accent);
            outline-offset: 2px;
        }

        .nh-modal-body {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 14px var(--nh-settings-pad-x) 8px;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.14) transparent;
        }
        .nh-modal-body::-webkit-scrollbar { width: 8px; }
        .nh-modal-body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.12);
            border-radius: 999px;
            border: 2px solid transparent;
            background-clip: padding-box;
        }
        .nh-tab-content { display: none; animation: fadeIn 0.16s ease-out; }
        .nh-tab-content.active { display: block; }

        .nh-setting-group-title {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 16px 0 10px;
            padding: 0 2px;
            border: none;
            background: none;
            color: #ff8aaa;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            text-align: left;
        }
        .nh-setting-group-title:first-child { margin-top: 2px; }
        .nh-setting-group-title::before {
            content: "";
            width: 3px;
            height: 12px;
            border-radius: 999px;
            background: var(--nh-color-accent);
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.16);
        }

        .nh-setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 14px;
            margin: 0 0 8px;
            padding: 12px 14px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 12px;
            background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015));
            transition: border-color 0.15s ease, background 0.15s ease;
        }
        .nh-setting-item:hover {
            border-color: rgba(237, 37, 83, 0.22);
            background: linear-gradient(180deg, rgba(237, 37, 83, 0.08), rgba(255,255,255,0.02));
        }
        .nh-setting-item-compact {
            margin: 0 0 8px;
            padding: 10px 12px;
            background: rgba(0, 0, 0, 0.16);
        }
        .nh-setting-content {
            text-align: left;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 3px;
            min-width: 0;
            flex: 1 1 auto;
            max-width: none;
        }
        .nh-setting-label {
            font-size: 14px;
            line-height: 1.35;
            font-weight: 650;
            color: #f7f7f8;
        }
        .nh-info-text {
            color: #8f8f98;
            font-size: 12px;
            line-height: 1.45;
            margin-top: 0;
        }

        .nh-setting-sub-group {
            margin: 0 0 8px;
            padding: 10px;
            background: rgba(0, 0, 0, 0.18);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .nh-setting-sub-group-3 { display: flex; flex-wrap: wrap; }
        .nh-setting-sub-item {
            display: inline-flex;
            align-items: center;
            gap: 0;
            margin: 0;
            padding: 7px 12px;
            border-radius: 999px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(255, 255, 255, 0.04);
            color: #cfcfd6;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            user-select: none;
            transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .nh-setting-sub-item:hover {
            border-color: rgba(237, 37, 83, 0.35);
            color: #fff;
        }
        .nh-setting-sub-item:has(input:checked) {
            background: rgba(237, 37, 83, 0.18);
            border-color: rgba(237, 37, 83, 0.45);
            color: #fff;
        }
        .nh-setting-sub-item input {
            position: absolute;
            opacity: 0;
            width: 0;
            height: 0;
            pointer-events: none;
        }

        .nh-switch {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 26px;
            flex: 0 0 auto;
        }
        .nh-switch input { opacity: 0; width: 0; height: 0; }
        .nh-slider {
            position: absolute;
            cursor: pointer;
            inset: 0;
            background: #3a3a42;
            border: 1px solid rgba(255,255,255,0.06);
            transition: background 0.18s ease, box-shadow 0.18s ease;
            border-radius: 999px;
        }
        .nh-slider:before {
            position: absolute;
            content: "";
            height: 20px;
            width: 20px;
            left: 2px;
            top: 2px;
            background: #fff;
            transition: transform 0.18s ease;
            border-radius: 50%;
            box-shadow: 0 1px 3px rgba(0,0,0,0.35);
        }
        input:checked + .nh-slider {
            background: linear-gradient(180deg, #f03a64, #d61d4e);
            border-color: transparent;
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.14);
        }
        input:checked + .nh-slider:before { transform: translateX(18px); }

        .nh-select {
            background: var(--nh-color-bg-muted);
            color: #f4f4f4;
            border: 1px solid var(--nh-color-border);
            padding: 4px 10px;
            border-radius: var(--nh-radius-sm);
            outline: none;
            font-size: var(--nh-font-size-md);
            color-scheme: dark;
        }
        .nh-select:focus { border-color: var(--nh-color-accent); }
        .nh-select option { background: #2a2a2a; color: #f4f4f4; }

        .nh-settings-actions {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 10px;
            flex: 0 0 auto;
            margin: 0;
            padding: 14px var(--nh-settings-pad-x) 16px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            background: linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.22));
        }
        .nh-btn {
            padding: 9px 16px;
            border-radius: 10px;
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-weight: 700;
            transition: background 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
        }
        .nh-btn:active { transform: translateY(1px); }
        .nh-btn-primary {
            background: linear-gradient(180deg, #f03a64, #d61d4e);
            color: white;
            margin-left: 0;
            box-shadow: 0 8px 18px rgba(237, 37, 83, 0.28);
        }
        .nh-btn-primary:hover { background: linear-gradient(180deg, #ff4b72, #e02055); }
        .nh-btn-secondary {
            background: rgba(255, 255, 255, 0.06);
            color: #d8d8de;
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .nh-btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
        }
        .nh-force-update-wrap { margin: 12px 0 4px; text-align: center; }
        .nh-btn-block {
            width: 100%;
            font-size: 13px;
            padding: 11px 14px;
            border-radius: 12px;
        }
        .nh-api-key-card {
            margin: 0 0 8px;
            padding: 14px;
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 14px;
            background:
                linear-gradient(180deg, rgba(237, 37, 83, 0.08), transparent 48%),
                rgba(0, 0, 0, 0.18);
        }
        .nh-api-key-content { max-width: none; margin-bottom: 10px; }
        .nh-password-input {
            width: 100%;
            box-sizing: border-box;
            padding: 10px 12px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.28);
            color: var(--nh-color-text);
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 13px;
        }
        .nh-password-input:focus {
            outline: none;
            border-color: rgba(237, 37, 83, 0.55);
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.16);
        }
        .nh-api-key-status {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 10px;
            color: #9a9aa3;
            font-size: 12px;
        }
        .nh-api-key-status strong { color: #f0f0f3; font-weight: 700; }
        .nh-api-key-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .nh-api-key-actions .nh-btn { margin-left: 0; }
        .nh-api-key-message {
            min-height: 16px;
            margin-top: 10px;
            color: #8f8f98;
            font-size: 12px;
        }
        .nh-api-key-message[data-state="success"] { color: #8bdc9b; }
        .nh-api-key-message[data-state="failure"] { color: #ff9a9a; }

        .nh-quicktags-list {
            margin: 0 0 10px;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-left: 3px solid rgba(237, 37, 83, 0.55);
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.16);
        }
        .nh-quicktags-list.is-hidden { display: none; }
        .nh-quicktags-label {
            font-size: 12px;
            color: #8f8f98;
            margin-bottom: 8px;
            font-weight: 600;
        }
        .nh-preview-popup-settings {
            margin: 0 0 10px;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-left: 3px solid rgba(237, 37, 83, 0.45);
            background: rgba(0, 0, 0, 0.16);
            border-radius: 12px;
        }
        .nh-preview-popup-settings.is-hidden { display: none; }

        .nh-setting-control {
            display: inline-flex;
            align-items: center;
            justify-content: flex-end;
            min-width: 108px;
            min-height: 36px;
            padding: 0 10px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.22);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
            flex: 0 0 auto;
        }
        .nh-setting-control-select {
            position: relative;
            min-width: 148px;
            max-width: 200px;
            padding-right: 30px;
        }
        .nh-setting-control-select::after {
            content: "";
            position: absolute;
            right: 12px;
            top: 50%;
            width: 7px;
            height: 7px;
            border-right: 2px solid rgba(255,255,255,0.55);
            border-bottom: 2px solid rgba(255,255,255,0.55);
            transform: translateY(-62%) rotate(45deg);
            pointer-events: none;
        }
        .nh-setting-unit {
            margin-left: 6px;
            color: #8f8f98;
            font-size: 12px;
            font-weight: 700;
        }
        .nh-number-input {
            width: 56px;
            padding: 2px 0;
            border: none;
            background: transparent;
            color: #fff;
            font-size: 16px;
            line-height: 1;
            font-weight: 700;
            text-align: right;
            font-variant-numeric: tabular-nums;
            appearance: textfield;
            -moz-appearance: textfield;
        }
        .nh-number-input:focus { outline: none; }
        .nh-number-input::-webkit-outer-spin-button,
        .nh-number-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .nh-setting-control:focus-within {
            border-color: rgba(237, 37, 83, 0.55);
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.14), inset 0 1px 0 rgba(255,255,255,0.03);
        }
        .nh-setting-control .nh-select {
            width: 100%;
            border: none;
            background: transparent;
            padding: 2px 0;
            min-width: 100px;
            text-align: right;
            color: #fff;
            -webkit-text-fill-color: #fff;
            appearance: none;
            font-weight: 650;
            font-size: 13px;
        }
        .nh-setting-control .nh-select:focus { border-color: transparent; }

        #nh-web-settings-btn { display: inline-block; vertical-align: middle; }
        ul.menu.left { display: flex !important; flex-wrap: nowrap !important; align-items: center !important; float: left; height: 45px; }
        ul.menu.left > li:not(.dropdown) { display: flex; align-items: center; height: 100%; }
        ul.menu.left > li.dropdown { position: relative; display: flex; align-items: center; height: 100%; }
        ul.menu.left > li.dropdown > .dropdown-menu {
            display: none !important;
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            min-width: 140px;
            z-index: 1005;
            white-space: nowrap;
        }
        ul.menu.left > li.dropdown:hover > .dropdown-menu,
        ul.menu.left > li.dropdown:focus-within > .dropdown-menu {
            display: block !important;
        }
        ul.menu.left > li.dropdown > .dropdown-menu > li {
            display: block;
            height: auto;
        }
        #nh-web-settings-btn a { display: flex; align-items: center; height: 100%; color: rgb(217, 217, 217); text-decoration: none; font-weight: bold; padding: 0 15px; transition: color 0.2s; }
        #nh-web-settings-btn a:hover { color: var(--nh-color-text); }
        #nh-web-settings-btn i { margin-right: 5px; font-size: var(--nh-font-size-lg); }

        .nh-lang-container { position: relative; margin-left: 10px; margin-right: 5px; z-index: 1002; }
        .nh-lang-btn { background-color: var(--nh-color-bg-strong); color: rgb(217, 217, 217); border: 1px solid var(--nh-color-border); border-radius: var(--nh-radius-sm); padding: 5px 10px; font-size: var(--nh-font-size-md); font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: space-between; min-width: 90px; transition: all 0.2s; }
        .nh-lang-btn:hover, .nh-lang-btn.active { background-color: var(--nh-color-bg-hover); border-color: var(--nh-color-accent); color: #fff; }
        .nh-lang-arrow { margin-left: 8px; font-size: 10px; color: var(--nh-color-accent); }
        .nh-lang-menu { position: absolute; top: 100%; right: 0; margin-top: 5px; background-color: var(--nh-color-bg); border: 1px solid var(--nh-color-border); border-radius: var(--nh-radius-sm); box-shadow: var(--nh-shadow-md); display: none; flex-direction: column; min-width: 120px; overflow: hidden; }
        .nh-lang-menu.show { display: flex; }
        .nh-lang-item { padding: 8px 12px; cursor: pointer; display: flex; align-items: center; color: var(--nh-color-text-soft); font-size: var(--nh-font-size-md); transition: background 0.1s; user-select: none; }
        .nh-lang-item:hover { background-color: var(--nh-color-bg-hover); color: #fff; }
        .nh-lang-item.selected { color: var(--nh-color-accent); font-weight: bold; background-color: var(--nh-color-accent-soft); }
        .nh-lang-checkbox { width: 14px; height: 14px; border: 1px solid #555; border-radius: 2px; margin-right: 8px; display: flex; align-items: center; justify-content: center; transition: all 0.1s; }
        .nh-lang-item.selected .nh-lang-checkbox { background-color: var(--nh-color-accent); border-color: var(--nh-color-accent); }
        .nh-lang-item.selected .nh-lang-checkbox::after { content: "✓"; color: #fff; font-size: 10px; line-height: 1; }
        .nh-helper-hidden { display: none !important; }
        .gallery.blacklisted,
        .gallery.nh-site-blacklisted {
            display: none !important;
        }
        .nh-page-number { position: absolute; top: 5px; right: 5px; background-color: rgba(0,0,0,0.6); color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; z-index: 10; pointer-events: none; }
        .nh-scroll-page-marker {
            width: fit-content;
            min-width: 96px;
            margin: 12px auto 14px;
            padding: 4px 14px;
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(35,35,35,0.95), rgba(22,22,22,0.95));
            color: #fff;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 6px 14px rgba(0,0,0,0.35);
            font-size: 12px;
            font-weight: bold;
            text-align: center;
            letter-spacing: 0.4px;
        }
        #nh-infinite-sentinel {
            margin: 16px auto 10px;
            padding: 10px 14px;
            width: min(100%, 420px);
            text-align: center;
            color: var(--nh-color-text-soft);
            font-size: var(--nh-font-size-md);
            background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015));
            border: 1px solid var(--nh-color-border);
            border-radius: var(--nh-radius-md);
            box-shadow: var(--nh-shadow-sm);
        }
        #nh-infinite-sentinel.is-loading {
            color: #fff;
            border-color: rgba(237, 37, 83, 0.45);
        }
        #nh-infinite-sentinel.is-loading::after {
            content: "";
            display: block;
            width: 24px;
            height: 24px;
            margin: 10px auto 0;
            border-radius: 999px;
            border: 2px solid rgba(255,255,255,0.15);
            border-top-color: var(--nh-color-accent);
            animation: nh-infinite-spin 0.8s linear infinite;
        }
        #nh-infinite-sentinel.is-error {
            color: #ffd3dd;
            border-color: rgba(255, 99, 132, 0.4);
        }
        #nh-infinite-sentinel.is-actionable {
            cursor: pointer;
            color: #fff;
            border-color: var(--nh-color-accent);
        }
        #nh-infinite-sentinel.is-actionable:hover {
            background: rgba(237, 37, 83, 0.16);
        }
        [data-nh-infinite-appended="1"].index-container,
        [data-nh-infinite-appended="1"].gallery-grid {
            contain-intrinsic-size: auto 1200px;
        }
        .nh-offscreen-page {
            content-visibility: auto;
        }
        #nh-infinite-sentinel.is-done {
            color: var(--nh-color-text-muted);
            opacity: 0.85;
        }
        @keyframes nh-infinite-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* detail / blacklist tools (settings modal styles defined above) */
        .nh-detail-tag-tools { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; }
        .nh-tag-blacklist-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            margin-left: 4px;
            border: none;
            border-radius: 999px;
            background: rgba(255,255,255,0.06);
            color: var(--nh-color-text-subtle);
            cursor: pointer;
            vertical-align: middle;
            transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
        }
        .nh-tag-blacklist-btn:hover {
            background: rgba(237, 37, 83, 0.15);
            color: var(--nh-color-accent);
        }
        .nh-tag-blacklist-btn.is-blacklisted {
            background: rgba(237, 37, 83, 0.16);
            color: var(--nh-color-accent);
        }
        .nh-tag-blacklist-btn.is-loading,
        .nh-tag-blacklist-btn:disabled {
            opacity: 0.7;
            cursor: wait;
        }
        .nh-tag-blacklist-btn i {
            font-size: 10px;
            line-height: 1;
            pointer-events: none;
        }
        .nh-blacklist-filter-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 12px 0 10px;
        }
        .nh-blacklist-filter-btn {
            padding: 4px 10px;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 999px;
            background: rgba(255,255,255,0.04);
            color: var(--nh-color-text-soft);
            cursor: pointer;
            font-size: 12px;
            line-height: 1.2;
            transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .nh-blacklist-filter-btn:hover {
            background: rgba(255,255,255,0.08);
            color: #fff;
        }
        .nh-blacklist-filter-btn.is-active {
            background: rgba(237, 37, 83, 0.14);
            border-color: rgba(237, 37, 83, 0.45);
            color: var(--nh-color-accent);
        }
        .nh-blacklist-filter-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 18px;
            height: 18px;
            margin-left: 6px;
            padding: 0 5px;
            border-radius: 999px;
            background: rgba(255,255,255,0.08);
            color: inherit;
            font-size: 11px;
            line-height: 1;
        }
        .nh-blacklist-filter-empty {
            margin: 8px 0 0;
            color: var(--nh-color-text-subtle);
            font-size: 12px;
        }
        .nh-reading-mode-entry {
            position: relative;
        }
        .nh-reading-mode-entry.is-loading {
            opacity: 0.75;
            pointer-events: none;
        }
        .nh-number-input {
            width: 96px;
            padding: 5px 8px;
            background: var(--nh-color-bg-muted);
            color: var(--nh-color-text);
            border: 1px solid var(--nh-color-border);
            border-radius: var(--nh-radius-sm);
            outline: none;
            font-size: var(--nh-font-size-md);
            text-align: right;
            box-sizing: border-box;
        }
        .nh-number-input:focus {
            border-color: var(--nh-color-accent);
        }
        .nh-reading-open,
        .nh-reading-open body {
            overflow: hidden !important;
        }
        #nh-reading-overlay {
            position: fixed;
            inset: 0;
            z-index: 10060;
            background: rgba(10, 10, 10, 0.96);
            color: var(--nh-color-text);
            font-family: var(--nh-font-family);
        }
        .nh-reading-shell {
            position: relative;
            width: 100%;
            height: 100%;
        }
        .nh-reading-main {
            position: relative;
            width: 100%;
            height: 100%;
        }
        .nh-reading-topbar {
            position: absolute;
            top: 10px;
            left: 12px;
            right: 18px;
            z-index: 6;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            pointer-events: none;
        }
        .nh-reading-meta {
            min-width: 0;
            max-width: min(58vw, 560px);
            padding: 0;
            border: none;
            background: none;
            box-shadow: none;
            backdrop-filter: none;
        }
        .nh-reading-title {
            font-size: 13px;
            font-weight: 600;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
            text-shadow: 0 2px 10px rgba(0,0,0,0.75);
        }
        .nh-reading-status {
            margin-top: 3px;
            color: rgba(255,255,255,0.78);
            font-size: 10px;
            line-height: 1.2;
            text-shadow: 0 2px 10px rgba(0,0,0,0.75);
        }
        .nh-reading-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 0 0 auto;
            pointer-events: auto;
        }
        .nh-reading-close {
            padding: 6px 11px;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 999px;
            background: rgba(18,18,18,0.72);
            color: #fff;
            cursor: pointer;
            font-size: 11px;
            line-height: 1;
            box-shadow: 0 8px 20px rgba(0,0,0,0.16);
            backdrop-filter: blur(8px);
            transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        }
        .nh-reading-close:hover {
            background: rgba(255,255,255,0.10);
            border-color: rgba(255,255,255,0.18);
            transform: translateY(-1px);
        }
        .nh-reading-scroller {
            height: 100%;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 12px 0 24px;
            scrollbar-width: none;
            -ms-overflow-style: none;
        }
        .nh-reading-scroller::-webkit-scrollbar {
            width: 0;
            height: 0;
        }
        .nh-reading-pages {
            width: min(100%, var(--nh-reading-max-width, 1360px));
            margin: 0 auto;
            padding: 0 clamp(8px, 1vw, 14px);
            box-sizing: border-box;
        }
        .nh-reading-page {
            position: relative;
            margin: 0 0 var(--nh-reading-gap, 10px);
        }
        .nh-reading-page:last-child {
            margin-bottom: 0;
        }
        .nh-reading-page img {
            display: block;
            width: 100%;
            height: auto;
            min-height: 120px;
            margin: 0 auto;
            border-radius: 2px;
            background: rgba(255,255,255,0.015);
            box-shadow: none;
        }
        .nh-reading-tools {
            position: absolute;
            left: 0;
            top: 50%;
            z-index: 5;
            display: flex;
            flex-direction: column;
            gap: 10px;
            width: 86px;
            padding: 10px 10px 10px 8px;
            border-radius: 0 14px 14px 0;
            background: rgba(18,18,18,0.58);
            border: 1px solid rgba(255,255,255,0.08);
            border-left: none;
            box-shadow: 0 10px 24px rgba(0,0,0,0.12);
            backdrop-filter: blur(8px);
            transform: translateY(-50%) translateX(-8px);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease, transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        #nh-reading-overlay.is-tools-visible .nh-reading-tools,
        .nh-reading-tools:focus-within,
        .nh-reading-tools:hover {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(-50%);
            background: rgba(18,18,18,0.82);
            border-color: rgba(255,255,255,0.12);
            box-shadow: 0 12px 28px rgba(0,0,0,0.18);
        }
        .nh-reading-tool-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .nh-reading-tool-caption {
            color: rgba(255,255,255,0.72);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .nh-reading-tool-input-wrap {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 0 8px;
            height: 30px;
            border-radius: 999px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.08);
        }
        .nh-reading-tool-input-wrap:focus-within {
            border-color: rgba(237, 37, 83, 0.65);
            background: rgba(255,255,255,0.1);
            box-shadow: 0 0 0 2px rgba(237, 37, 83, 0.16);
        }
        .nh-reading-tool-input {
            width: 100%;
            min-width: 0;
            padding: 0;
            border: none;
            background: transparent;
            color: #fff;
            font-size: 12px;
            line-height: 1;
            text-align: right;
            font-variant-numeric: tabular-nums;
            outline: none;
            appearance: textfield;
        }
        .nh-reading-tool-input::-webkit-outer-spin-button,
        .nh-reading-tool-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .nh-reading-tool-unit {
            color: rgba(255,255,255,0.62);
            font-size: 11px;
            flex: 0 0 auto;
        }
        .nh-reading-page.is-loading img {
            opacity: 0.82;
            filter: saturate(0.9);
        }
        .nh-reading-page.is-error img {
            opacity: 0.45;
        }
        .nh-reading-page.is-error {
            cursor: pointer;
        }
        .nh-reading-page.is-error::after {
            content: attr(data-retry-text);
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            padding: 8px 14px;
            border-radius: var(--nh-radius-md);
            background: rgba(20,20,20,0.88);
            border: 1px solid rgba(255, 99, 132, 0.45);
            color: #ffd3dd;
            font-size: var(--nh-font-size-md);
            white-space: nowrap;
            pointer-events: none;
        }
        .nh-reading-scrollbar {
            position: absolute;
            top: 42px;
            right: 9px;
            bottom: 14px;
            width: 6px;
            padding: 0;
            overflow: visible;
            z-index: 2;
            touch-action: none;
            user-select: none;
        }
        .nh-reading-scrollbar-track {
            position: relative;
            width: 100%;
            height: 100%;
            padding: 0;
            border-radius: 999px;
            background: rgba(255,255,255,0.08);
            display: flex;
            flex-direction: column;
            gap: 0;
            overflow: hidden;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
            backdrop-filter: blur(2px);
        }
        .nh-reading-scrollbar.is-dragging .nh-reading-scrollbar-track {
            box-shadow: inset 0 0 0 1px rgba(237, 37, 83, 0.45);
        }
        .nh-reading-scrollbar-popper {
            --nh-reading-scrollbar-popper-y: 0px;
            position: absolute;
            top: 0;
            right: 15px;
            min-width: 48px;
            padding: 4px 10px;
            border-radius: 6px;
            background: rgba(34,34,34,0.94);
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.3;
            text-align: center;
            white-space: nowrap;
            box-shadow: 0 8px 18px rgba(0,0,0,0.32);
            border: 1px solid rgba(255,255,255,0.08);
            opacity: 0;
            pointer-events: none;
            transform: translate3d(0, var(--nh-reading-scrollbar-popper-y), 0);
            transition: opacity 0.15s ease;
            z-index: 4;
        }
        .nh-reading-scrollbar-popper::after {
            content: "";
            position: absolute;
            top: 50%;
            right: -6px;
            width: 0;
            height: 0;
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
            border-left: 6px solid rgba(34,34,34,0.94);
            transform: translateY(-50%);
        }
        .nh-reading-scrollbar:hover .nh-reading-scrollbar-popper,
        .nh-reading-scrollbar.is-dragging .nh-reading-scrollbar-popper {
            opacity: 1;
        }
        .nh-reading-scrollbar-thumb {
            position: absolute;
            top: 0;
            left: -1px;
            width: 8px;
            min-height: 18px;
            border-radius: 999px;
            background: rgba(255,255,255,0.75);
            box-shadow: 0 2px 10px rgba(0,0,0,0.28);
            pointer-events: none;
            opacity: 0.28;
            transition: box-shadow 0.15s ease, background-color 0.15s ease, opacity 0.15s ease;
            z-index: 3;
        }
        .nh-reading-scrollbar:hover .nh-reading-scrollbar-thumb {
            opacity: 0.92;
        }
        .nh-reading-scrollbar.is-dragging .nh-reading-scrollbar-thumb {
            background: #fff;
            box-shadow: 0 2px 14px rgba(237, 37, 83, 0.45);
            opacity: 1;
        }
        .nh-reading-scrollbar-item {
            flex: 1 1 0;
            min-height: 3px;
            padding: 0;
            border: none;
            border-radius: 0;
            background: rgba(255,255,255,0.15);
            cursor: ns-resize;
            transition: background-color 0.15s ease, opacity 0.15s ease;
            appearance: none;
        }
        .nh-reading-scrollbar-item:hover {
            opacity: 0.95;
        }
        .nh-reading-scrollbar-item.is-active {
            background: var(--nh-color-accent);
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.55);
        }
        .nh-reading-scrollbar-item[data-state="wait"] {
            background: rgba(255,255,255,0.12);
        }
        .nh-reading-scrollbar-item[data-state="loading"] {
            background: rgba(237, 37, 83, 0.5);
        }
        .nh-reading-scrollbar-item[data-state="loaded"] {
            background: rgba(255,255,255,0.28);
        }
        .nh-reading-scrollbar-item[data-state="error"] {
            background: rgba(217, 32, 32, 0.75);
        }

        /* Preview Feature Styles */
        .gallery.is-previewing .cover { padding-bottom: 0 !important; height: auto !important; display: flex; flex-direction: column; }
        .gallery.is-previewing .cover img { position: relative !important; height: auto !important; width: 100% !important; max-height: none !important; object-fit: contain; }
        .inline-preview-ui { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; }
        .gallery:hover .inline-preview-ui, .gallery.is-previewing .inline-preview-ui { display: block; }
        .gallery { vertical-align: top !important; }
        .hotzone { position: absolute; top: 0; height: calc(100% - 15px); width: 40%; cursor: default; z-index: 20; }
        .hotzone-left { left: 0; } .hotzone-right { right: 0; }
        .seek-container { position: absolute; bottom: 0; left: 0; width: 100%; height: 20px; z-index: 40; cursor: pointer; display: flex; align-items: flex-end; }
        .seek-bg { width: 100%; height: 3px; background: rgba(255,255,255,0.2); transition: height 0.1s; position: relative; backdrop-filter: blur(2px); }
        .seek-container:hover .seek-bg { height: 15px; background: rgba(255,255,255,0.3); }
        .seek-fill { height: 100%; background: var(--nh-color-accent); width: 0%; transition: width 0.1s; }
        .seek-tooltip { position: absolute; bottom: 17px; transform: translateX(-50%); background: var(--nh-color-accent); color: #fff; font-size: 10px; padding: 2px 4px; border-radius: .3em; opacity: 0; pointer-events: none; white-space: nowrap; font-weight: bold; transition: opacity 0.1s; }
        .seek-container:hover .seek-tooltip { opacity: 1; }
        .tag-trigger { position: absolute; top: 5px; left: 5px; background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: .3em; cursor: help; z-index: 50; font-family: var(--nh-font-family); opacity: 0.7; border: 1px solid rgba(255,255,255,0.2); transition: all 0.2s; }
        .tag-trigger:hover { opacity: 1; background: var(--nh-color-accent); border-color: var(--nh-color-accent); }
        .tag-popup { display: none; position: absolute; top: 25px; left: 5px; width: 215px; max-height: 250px; overflow-y: auto; background: rgba(15,15,15,0.95); color: #ddd; border: 1px solid var(--nh-color-border); border-radius: .3em; padding: 8px; font-size: 11px; z-index: 60; box-shadow: var(--nh-shadow-sm); text-align: left; line-height: 1.4; }
        .tag-trigger:hover + .tag-popup, .tag-popup:hover { display: block; }
        .tag-category { color: var(--nh-color-accent); font-weight: bold; margin-bottom: 2px; margin-top: 6px; font-size: 10px; text-transform: uppercase; }
        .tag-category:first-child { margin-top: 0; }
        .tag-pill { display: inline-block; transition: all 0.2s; background: var(--nh-color-border); padding: 1px 4px; margin: 1px; border-radius: .3em; color: var(--nh-color-text-soft); }
        .nh-tag-popup-state { padding: 10px; text-align: center; color: var(--nh-color-text-subtle); font-style: italic; }
        .nh-empty-state { padding: 5px; color: var(--nh-color-text-subtle); }
        .nh-preview-popup {
            --nh-preview-popup-width: 34vw;
            --nh-preview-popup-max-height: 70vh;
            --nh-preview-popup-media-width: auto;
            --nh-preview-popup-media-height: var(--nh-preview-popup-max-height);
            position: fixed;
            top: 0;
            left: 0;
            width: min(var(--nh-preview-popup-width), calc(100vw - 24px));
            padding: 10px 10px 12px;
            border-radius: 14px;
            background: rgba(16,16,16,0.96);
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 18px 44px rgba(0,0,0,0.42);
            z-index: 10020;
            opacity: 0;
            pointer-events: none;
            transform: translate3d(0, 8px, 0) scale(0.98);
            transition: opacity 0.16s ease, transform 0.16s ease;
            backdrop-filter: blur(10px);
        }
        .nh-preview-popup.is-visible {
            opacity: 1;
            pointer-events: auto;
            transform: translate3d(0, 0, 0) scale(1);
        }
        .nh-preview-media {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            width: min(100%, var(--nh-preview-popup-media-width));
            height: var(--nh-preview-popup-media-height);
            margin: 0 auto;
            border-radius: 10px;
            background: linear-gradient(180deg, rgba(24,24,24,0.96), rgba(8,8,8,0.98));
        }
        .nh-preview-image {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #101010;
        }
        .nh-preview-image.is-empty {
            visibility: hidden;
        }
        .nh-preview-hotzone {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 24%;
            border: none;
            padding: 0;
            background: transparent;
            cursor: pointer;
            z-index: 2;
        }
        .nh-preview-hotzone::before {
            content: "";
            position: absolute;
            inset: 0;
            opacity: 0;
            transition: opacity 0.18s ease;
        }
        .nh-preview-hotzone:hover::before,
        .nh-preview-hotzone:focus-visible::before {
            opacity: 1;
        }
        .nh-preview-hotzone-left { left: 0; }
        .nh-preview-hotzone-left::before { background: linear-gradient(90deg, rgba(0,0,0,0.34), transparent); }
        .nh-preview-hotzone-right { right: 0; }
        .nh-preview-hotzone-right::before { background: linear-gradient(270deg, rgba(0,0,0,0.34), transparent); }
        .nh-preview-popup .tag-trigger {
            top: 8px;
            left: 8px;
            z-index: 4;
        }
        .nh-preview-popup .tag-popup {
            top: 34px;
            left: 8px;
            width: min(320px, calc(100vw - 48px));
            max-height: 240px;
            z-index: 5;
        }
        .nh-preview-popup .seek-container {
            position: relative;
            left: auto;
            bottom: auto;
            width: 100%;
            height: 24px;
            margin-top: 10px;
            align-items: center;
        }
        .nh-preview-popup .seek-bg {
            height: 4px;
            border-radius: 999px;
            overflow: hidden;
        }
        .nh-preview-popup .seek-container:hover .seek-bg,
        .nh-preview-popup.is-dragging .seek-bg {
            height: 12px;
        }
        .nh-preview-popup .seek-tooltip {
            bottom: 18px;
        }
        #nh-dev-panel { position: fixed; right: 12px; bottom: 12px; width: min(300px, calc(100vw - 24px)); background: rgba(20,20,20,0.92); border: 1px solid var(--nh-color-border); border-radius: var(--nh-radius-md); z-index: 10050; color: #ddd; font-size: 11px; line-height: 1.35; font-family: Consolas, monospace; box-shadow: 0 8px 20px rgba(0,0,0,0.45); pointer-events: none; }
        #nh-dev-panel .hd { padding: 6px 8px; border-bottom: 1px solid var(--nh-color-border); color: var(--nh-color-accent); font-weight: bold; }
        #nh-dev-panel .groups { padding: 6px; display: flex; flex-direction: column; gap: 6px; }
        #nh-dev-panel .group { border: 1px solid var(--nh-color-border); border-radius: var(--nh-radius-sm); background: rgba(255,255,255,0.02); overflow: hidden; }
        #nh-dev-panel .gh { padding: 4px 6px; border-bottom: 1px solid var(--nh-color-border); color: var(--nh-color-accent); font-weight: bold; background: rgba(255,255,255,0.03); }
        #nh-dev-panel .gsh { padding: 4px 6px; color: var(--nh-color-text-subtle); font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; border-top: 1px solid rgba(255,255,255,0.04); background: rgba(255,255,255,0.015); }
        #nh-dev-panel .gsh:first-of-type { border-top: none; }
        #nh-dev-panel .gsb { padding: 4px 6px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1px 6px; }
        #nh-dev-panel .gb { padding: 5px 6px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1px 6px; }
        #nh-dev-panel .gsb .k { color: var(--nh-color-text-muted); }
        #nh-dev-panel .gsb .v { color: var(--nh-color-text); text-align: right; max-width: 132px; word-break: break-all; }
        #nh-dev-panel .gb .k { color: var(--nh-color-text-muted); }
        #nh-dev-panel .gb .v { color: var(--nh-color-text); text-align: right; max-width: 132px; word-break: break-all; }

        .nh-btn:focus-visible,
        .nh-tab-btn:focus-visible,
        .nh-select:focus-visible,
        .nh-lang-btn:focus-visible,
        .nh-helper-tag-btn:focus-visible,
        .nh-preview-hotzone:focus-visible,
        #nh-web-settings-btn a:focus-visible,
        .tag-trigger:focus-visible {
            outline: 2px solid var(--nh-color-accent);
            outline-offset: 2px;
            box-shadow: 0 0 0 3px var(--nh-focus-ring);
        }
        .nh-setting-sub-item input:focus-visible,
        .nh-switch input:focus-visible + .nh-slider,
        .nh-lang-item:focus-visible {
            outline: 2px solid var(--nh-color-accent);
            outline-offset: 2px;
            box-shadow: 0 0 0 3px var(--nh-focus-ring);
        }

        @media (max-width: 900px) {
            ul.menu.left { flex-wrap: wrap !important; height: auto !important; justify-content: flex-start; row-gap: 4px; }
            ul.menu.left > li:not(.dropdown) { height: auto; min-height: 36px; }
            ul.menu.left > li.dropdown { height: auto; min-height: 36px; }
            #nh-web-settings-btn a { padding: 0 8px; }
            #nh-lang-filter { margin-left: auto; }
            .nh-lang-container { margin-left: 4px; margin-right: 0; }
            .nh-lang-btn { min-width: auto; padding: 5px 8px; }
            .nh-preview-popup { display: none !important; }
        }
        @media (max-width: 768px) {
            #nh-settings-overlay { padding: 10px 8px; align-items: flex-end; }
            #nh-settings-modal {
                width: min(100vw - 16px, 560px);
                max-height: min(92vh, 820px);
                border-radius: 16px 16px 12px 12px;
                --nh-settings-pad-x: 14px;
            }
            .nh-modal-header { padding-top: 14px; }
            .nh-tab-btn { padding: 7px 12px; font-size: 12px; }
            .nh-setting-item { padding: 11px 12px; gap: 10px; }
            .nh-setting-control-select { min-width: 128px; max-width: 160px; }
            .nh-api-key-status { grid-template-columns: 1fr; }
            .nh-settings-actions { gap: 8px; }
            .nh-settings-actions .nh-btn { flex: 1 1 auto; text-align: center; }
            .nh-reading-topbar {
                top: 10px;
                left: 10px;
                right: 12px;
                gap: 8px;
            }
            .nh-reading-meta {
                max-width: calc(100vw - 104px);
            }
            .nh-reading-title { font-size: 12px; }
            .nh-reading-status { font-size: 10px; }
            .nh-reading-close {
                padding: 6px 10px;
                font-size: 11px;
            }
            .nh-reading-tools {
                width: 74px;
                padding: 8px 8px 8px 6px;
                gap: 8px;
            }
            .nh-reading-tool-caption,
            .nh-reading-tool-unit,
            .nh-reading-tool-input {
                font-size: 10px;
            }
            .nh-reading-tool-input-wrap {
                height: 28px;
                padding: 0 7px;
            }
            .nh-reading-pages { padding: 0 8px; }
            .nh-reading-scroller { padding-top: 10px; }
            .nh-reading-scrollbar {
                top: 40px;
                right: 4px;
                bottom: 12px;
                width: 5px;
            }
            .nh-reading-scrollbar-popper {
                right: 13px;
                min-width: 42px;
                padding: 3px 8px;
                font-size: 10px;
            }
            .nh-reading-scrollbar-thumb {
                width: 7px;
                left: -1px;
            }
            .hotzone { width: 34%; }
            .tag-popup { width: min(70vw, 220px); max-height: 180px; right: 5px; left: auto; top: 22px; }
        }
        @media (max-width: 520px) {
            #nh-lang-label { display: none; }
            .nh-lang-arrow { margin-left: 0; }
            .seek-container { height: 16px; }
            .seek-bg { height: 2px; }
            .seek-container:hover .seek-bg { height: 10px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .nh-helper-suggestion-item,
            .nh-helper-tag-btn,
            .nh-slider,
            .nh-slider:before,
            .nh-tab-btn,
            .seek-bg,
            .seek-fill,
            .seek-tooltip,
            .tag-trigger,
            .tag-pill,
            .nh-lang-btn,
            .nh-lang-item,
            #nh-helper-quick-tags,
            .nh-toast,
            .nh-tab-content {
                transition: none !important;
                animation: none !important;
            }
        }
    `,
        styleElements: new Map(),
        criticalCss: '',
        featureCss: null,
        deferredScheduled: false,
        buildCssBundles() {
            if (this.featureCss && this.criticalCss) {
                return {
                    criticalCss: this.criticalCss,
                    featureCss: this.featureCss
                };
            }

            const source = this.base;
            const readingStart = source.indexOf('.nh-reading-mode-entry {');
            const previewStart = source.indexOf('/* Preview Feature Styles */');
            const diagnosticsStart = source.indexOf('#nh-dev-panel {');
            const diagnosticsEnd = source.indexOf('.nh-btn:focus-visible,');

            const featureCss = {
                readingMode: '',
                preview: '',
                diagnostics: ''
            };

            if (readingStart === -1 || previewStart === -1 || diagnosticsStart === -1 || diagnosticsEnd === -1) {
                this.criticalCss = source;
                this.featureCss = featureCss;
                return {
                    criticalCss: this.criticalCss,
                    featureCss: this.featureCss
                };
            }

            featureCss.readingMode = source.slice(readingStart, previewStart).trim();
            featureCss.preview = source.slice(previewStart, diagnosticsStart).trim();
            featureCss.diagnostics = source.slice(diagnosticsStart, diagnosticsEnd).trim();
            this.criticalCss = [
                source.slice(0, readingStart),
                source.slice(diagnosticsEnd)
            ].join('').replace(/\n{3,}/g, '\n\n');
            this.featureCss = featureCss;
            return {
                criticalCss: this.criticalCss,
                featureCss: this.featureCss
            };
        },
        appendStyleText(key, cssText) {
            if (!cssText || this.styleElements.has(key)) return;
            const styleEl = document.createElement('style');
            styleEl.dataset.nhStyleKey = key;
            styleEl.textContent = cssText;
            document.head.appendChild(styleEl);
            this.styleElements.set(key, styleEl);
        },
        ensureFeatureStyles(featureName) {
            const { featureCss } = this.buildCssBundles();
            this.appendStyleText(`feature-${featureName}`, featureCss[featureName] || '');
        },
        scheduleDeferredStyles() {
            if (this.deferredScheduled) return;
            this.deferredScheduled = true;
            const injectDeferred = () => {
                this.ensureFeatureStyles('readingMode');
                this.ensureFeatureStyles('preview');
                this.ensureFeatureStyles('diagnostics');
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(injectDeferred, { timeout: 1200 });
            } else {
                setTimeout(injectDeferred, 800);
            }
        },
        inject() {
            const { criticalCss } = this.buildCssBundles();
            this.appendStyleText('critical-base', criticalCss);
            this.scheduleDeferredStyles();
        }
    };
