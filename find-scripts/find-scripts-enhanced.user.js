// ==UserScript==
// @name                 Find Scripts Enhanced
// @name:zh-CN           查找适用于当前网站的脚本（增强版）
// @namespace            https://github.com/utags
// @homepageURL          https://github.com/utags/userscripts#readme
// @supportURL           https://github.com/utags/userscripts/issues
// @version              1.1.0
// @description          Find userscripts for the current website from popular script repositories. Integrated with Userscript+ to show script counts.
// @description:zh-CN    查找适用于当前网站的用户脚本，支持多个脚本仓库。整合 Userscript+ 实时显示脚本数量。
// @author               abilatte
// @license              MIT
// @match                *://*/*
// @icon                 data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2064%2064%22%20fill%3D%22none%22%3E%3Ctext%20x%3D%2232%22%20y%3D%2232%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%20font-family%3D%22Menlo%2C%20Monaco%2C%20Consolas%2C%20Courier%20New%2C%20monospace%22%20font-size%3D%2242%22%20font-weight%3D%22700%22%20fill%3D%22%231f2937%22%3E%7B%7D%3C/text%3E%3C/svg%3E
// @noframes
// @grant                GM_registerMenuCommand
// @grant                GM_unregisterMenuCommand
// @grant                GM_openInTab
// @grant                GM.getValue
// @grant                GM_getValue
// @grant                GM.setValue
// @grant                GM_setValue
// @grant                GM.addValueChangeListener
// @grant                GM_addValueChangeListener
// @grant                GM_getResourceText
// @resource             siteData    https://greasyfork.org/scripts/by-site.json
// @resource             siteDataSF  https://sleazyfork.org/scripts/by-site.json
// @downloadURL          https://raw.githubusercontent.com/abilatte/userscripts/main/find-scripts/find-scripts-enhanced.user.js
// @updateURL            https://raw.githubusercontent.com/abilatte/userscripts/main/find-scripts/find-scripts-enhanced.user.js
// ==/UserScript==
//
;(() => {
  'use strict'
  var __defProp = Object.defineProperty
  var __getOwnPropSymbols = Object.getOwnPropertySymbols
  var __hasOwnProp = Object.prototype.hasOwnProperty
  var __propIsEnum = Object.prototype.propertyIsEnumerable
  var __defNormalProp = (obj, key, value) =>
    key in obj
      ? __defProp(obj, key, {
          enumerable: true,
          configurable: true,
          writable: true,
          value,
        })
      : (obj[key] = value)
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop)) __defNormalProp(a, prop, b[prop])
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop)) __defNormalProp(a, prop, b[prop])
      }
    return a
  }

  // Integrated from Userscript+
  let gfData = {}, sfData = {};
  try {
      if (typeof GM_getResourceText === 'function') {
        gfData = JSON.parse(GM_getResourceText('siteData') || '{}');
        sfData = JSON.parse(GM_getResourceText('siteDataSF') || '{}');
      }
  } catch (e) {
      console.error('Find Scripts: Failed to parse JSON resources', e);
  }

  const getBestMatchDomain = function(hostname, ...datasets) {
      const input = String(hostname || '').toLowerCase().trim().replace(/\.$/, '');
      if (!input) return '';
      const normalized = input.startsWith('www.') ? input.substring(4) : input;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized) || normalized === 'localhost') return normalized;
      const parts = normalized.split('.');
      let currentDomain = normalized;
      while (parts.length > 1) {
          for (let data of datasets) {
              if (Object.prototype.hasOwnProperty.call(data, currentDomain)) {
                  return currentDomain;
              }
          }
          parts.shift();
          currentDomain = parts.join('.');
      }
      return extractDomain(normalized);
  };

  const getScriptCount = function(domain, data) {
      if (Object.prototype.hasOwnProperty.call(data, domain)) {
          return data[domain];
      }
      return 0;
  };

  function registerMenu(caption, onClick) {
    if (typeof GM_registerMenuCommand === 'function') {
      return GM_registerMenuCommand(caption, onClick)
    }
    return 0
  }
  function unregisterMenu(menuId) {
    if (typeof GM_unregisterMenuCommand === 'function') {
      GM_unregisterMenuCommand(menuId)
    }
  }
  function openInTab(url, options) {
    if (typeof GM_openInTab === 'function') {
      GM_openInTab(url, options)
      return
    }
    globalThis.open(url, '_blank')
  }
  async function getValue(key, defaultValue) {
    if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
      return GM.getValue(key, defaultValue)
    }
    if (typeof GM_getValue === 'function') {
      return GM_getValue(key, defaultValue)
    }
    return defaultValue
  }
  async function setValue(key, value) {
    if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
      await GM.setValue(key, value)
      return
    }
    if (typeof GM_setValue === 'function') {
      GM_setValue(key, value)
    }
  }
  async function addValueChangeListener(key, callback) {
    if (
      typeof GM !== 'undefined' &&
      typeof GM.addValueChangeListener === 'function'
    ) {
      return GM.addValueChangeListener(key, callback)
    }
    if (typeof GM_addValueChangeListener === 'function') {
      return GM_addValueChangeListener(key, callback)
    }
    return 0
  }
  var doc = document
  function c(tag, opts) {
    const el = doc.createElement(tag)
    if (!opts) return el
    if (opts.className) el.className = opts.className
    if (opts.classes) for (const cls of opts.classes) el.classList.add(cls)
    if (opts.dataset)
      for (const k of Object.keys(opts.dataset)) el.dataset[k] = opts.dataset[k]
    if (opts.attrs)
      for (const k of Object.keys(opts.attrs)) el.setAttribute(k, opts.attrs[k])
    if (opts.style)
      for (const k of Object.keys(opts.style)) el.style[k] = opts.style[k]
    if ('text' in opts) el.textContent = opts.text || ''
    if (opts.type && 'type' in el) el.type = opts.type
    if ('value' in opts && 'value' in el) el.value = opts.value || ''
    if (opts.rows && 'rows' in el) el.rows = opts.rows
    if (opts.placeholder && 'placeholder' in el)
      el.placeholder = opts.placeholder
    if (typeof opts.checked === 'boolean' && 'checked' in el)
      el.checked = opts.checked
    if (opts.children) {
      for (const ch of opts.children) {
        if (typeof ch === 'string') el.append(doc.createTextNode(ch))
        else el.append(ch)
      }
    }
    return el
  }
  function addStyleToShadow(shadowRoot, css) {
    try {
      if (shadowRoot.adoptedStyleSheets) {
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(css)
        shadowRoot.adoptedStyleSheets = [
          ...shadowRoot.adoptedStyleSheets,
          sheet,
        ]
        return
      }
    } catch (e) {}
    const s = c('style', { text: css })
    shadowRoot.append(s)
  }
  function camelToKebab(str) {
    return str.replaceAll(/[A-Z]/g, (letter) =>
      '-'.concat(letter.toLowerCase())
    )
  }
  function ensureShadowRoot(options) {
    const key = options.hostDatasetKey || 'userscriptHost'
    const val = options.hostId
    const attrKey = camelToKebab(key)
    const sel = '[data-'.concat(attrKey, '="').concat(val, '"]')
    const existing = doc.querySelector(sel)
    if (existing instanceof HTMLDivElement && existing.shadowRoot) {
      if (!existing.isConnected || options.moveToEnd) {
        try {
          doc.documentElement.append(existing)
        } catch (e) {}
      }
      return { host: existing, root: existing.shadowRoot, existed: true }
    }
    const host = c('div', { dataset: { [key]: val } })
    const root = host.attachShadow({ mode: 'open' })
    if (options.style) {
      addStyleToShadow(root, options.style)
    }
    doc.documentElement.append(host)
    return { host, root, existed: false }
  }
  var normalizeToDefaultType = (val, dv) => {
    const t2 = typeof dv
    if (t2 === 'number') {
      const n = Number(val)
      return Number.isFinite(n) ? n : dv
    }
    if (t2 === 'object') {
      return val && typeof val === 'object' ? val : dv
    }
    return typeof val === t2 ? val : dv
  }
  function setOrDelete(obj, key, value, defaultValue) {
    const normalized = normalizeToDefaultType(value, defaultValue)
    const isEqual = (a, b) => {
      if (a === b) return true
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        try {
          return JSON.stringify(a) === JSON.stringify(b)
        } catch (e) {}
      }
      return false
    }
    if (isEqual(normalized, defaultValue)) {
      delete obj[key]
    } else {
      obj[key] = normalized
    }
  }
  var style_default =
    '/*! tailwindcss v4.1.18 | MIT License | https://tailwindcss.com */@layer properties;@layer theme, base, components, utilities;@layer theme{:host,:root{--font-sans:ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji";--font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;--color-red-50:oklch(97.1% 0.013 17.38);--color-red-500:oklch(63.7% 0.237 25.331);--color-blue-300:oklch(80.9% 0.105 251.813);--color-blue-400:oklch(70.7% 0.165 254.624);--color-blue-600:oklch(54.6% 0.245 262.881);--color-blue-700:oklch(48.8% 0.243 264.376);--color-gray-50:oklch(98.5% 0.002 247.839);--color-gray-100:oklch(96.7% 0.003 264.542);--color-gray-300:oklch(87.2% 0.01 258.338);--color-gray-400:oklch(70.7% 0.022 261.325);--color-gray-500:oklch(55.1% 0.027 264.364);--color-gray-600:oklch(44.6% 0.03 256.802);--color-gray-700:oklch(37.3% 0.034 259.733);--color-gray-800:oklch(27.8% 0.033 256.848);--color-gray-900:oklch(21% 0.034 264.665);--color-white:#fff;--spacing:4px;--font-weight-semibold:600;--font-weight-bold:700;--radius-md:6px;--radius-xl:12px;--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono)}}@layer base{*,::backdrop,::file-selector-button,:after,:before{border:0 solid;box-sizing:border-box;margin:0;padding:0}:host,html{line-height:1.5;-webkit-text-size-adjust:100%;font-family:var(--default-font-family,ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-moz-tab-size:4;-o-tab-size:4;tab-size:4;-webkit-tap-highlight-color:transparent}hr{border-top-width:1px;color:inherit;height:0}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,pre,samp{font-family:var(--default-mono-font-family,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-size:1em;font-variation-settings:var(--default-mono-font-variation-settings,normal)}small{font-size:80%}sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}table{border-collapse:collapse;border-color:inherit;text-indent:0}:-moz-focusring{outline:auto}progress{vertical-align:baseline}summary{display:list-item}menu,ol,ul{list-style:none}audio,canvas,embed,iframe,img,object,svg,video{display:block;vertical-align:middle}img,video{height:auto;max-width:100%}::file-selector-button,button,input,optgroup,select,textarea{background-color:transparent;border-radius:0;color:inherit;font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;opacity:1}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::-moz-placeholder{opacity:1}::placeholder{opacity:1}@supports (not (-webkit-appearance:-apple-pay-button)) or (contain-intrinsic-size:1px){::-moz-placeholder{color:currentcolor;@supports (color:color-mix(in lab,red,red)){color:color-mix(in oklab,currentcolor 50%,transparent)}}::placeholder{color:currentcolor;@supports (color:color-mix(in lab,red,red)){color:color-mix(in oklab,currentcolor 50%,transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit,::-webkit-datetime-edit-day-field,::-webkit-datetime-edit-hour-field,::-webkit-datetime-edit-meridiem-field,::-webkit-datetime-edit-millisecond-field,::-webkit-datetime-edit-minute-field,::-webkit-datetime-edit-month-field,::-webkit-datetime-edit-second-field,::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}::file-selector-button,button,input:where([type=button],[type=reset],[type=submit]){-webkit-appearance:button;-moz-appearance:button;appearance:button}::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}}@layer utilities{.container{width:100%;@media (width >= 40rem){max-width:640px}@media (width >= 48rem){max-width:768px}@media (width >= 64rem){max-width:1024px}@media (width >= 80rem){max-width:1280px}@media (width >= 96rem){max-width:1536px}}.grid{display:grid}}:host{all:initial}.user-settings{position:fixed;right:calc(var(--spacing)*3);top:calc(var(--spacing)*3);z-index:2147483647;--tw-ring-color:var(--user-color-ring,#111827)}.user-settings .panel{background-color:var(--color-gray-100);border-bottom-left-radius:var(--radius-xl);border-bottom-right-radius:var(--radius-xl);color:var(--color-gray-900);font-family:var(--font-sans);font-size:14px;max-height:90vh;overflow-y:auto;padding-inline:calc(var(--spacing)*4);padding-bottom:calc(var(--spacing)*4);padding-top:calc(var(--spacing)*0);width:420px;--tw-shadow:0 20px 25px -5px var(--tw-shadow-color,rgba(0,0,0,.1)),0 8px 10px -6px var(--tw-shadow-color,rgba(0,0,0,.1));background:#f2f2f7;box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow);box-shadow:0 10px 39px 10px #3e424238!important;scrollbar-color:rgba(156,163,175,.25) transparent;scrollbar-width:thin}.user-settings .grid{display:flex;flex-direction:column;gap:calc(var(--spacing)*3)}.user-settings .row{align-items:center;display:flex;gap:calc(var(--spacing)*3);justify-content:space-between;padding-block:calc(var(--spacing)*3);padding-inline:calc(var(--spacing)*4)}.user-settings .group{background-color:var(--color-white);border-radius:var(--radius-xl);gap:calc(var(--spacing)*0);overflow:hidden}.user-settings .group .row{background-color:var(--color-white);border-radius:0;border-style:var(--tw-border-style);border-width:0;padding-block:calc(var(--spacing)*3);padding-inline:calc(var(--spacing)*4);position:relative}.user-settings .group .row:not(:last-child):after{background:#e5e7eb;bottom:0;content:"";height:1px;left:16px;position:absolute;right:0}.user-settings .header-row{align-items:center;border-radius:0;display:flex;justify-content:center;padding-inline:calc(var(--spacing)*0);padding-bottom:calc(var(--spacing)*3);padding-top:calc(var(--spacing)*0)}.user-settings .panel-stuck .header-row .panel-title{opacity:0;transform:translateY(-2px);transition:opacity .15s ease,transform .15s ease}.user-settings label{color:var(--color-gray-600)}.user-settings .label-wrap{display:flex;flex-direction:column;gap:calc(var(--spacing)*1);min-width:60px;text-align:left}.user-settings .btn{border-color:var(--color-gray-300);border-radius:var(--radius-md);border-style:var(--tw-border-style);border-width:1px;color:var(--color-gray-700);padding-block:calc(var(--spacing)*1);padding-inline:calc(var(--spacing)*3);white-space:nowrap;&:hover{@media (hover:hover){background-color:var(--color-gray-50)}}}.user-settings .btn-danger{border-color:var(--color-red-500);color:var(--color-red-500);&:hover{@media (hover:hover){background-color:var(--color-red-50)}}}.user-settings .btn-ghost{border-radius:var(--radius-md);color:var(--color-gray-500);padding-block:calc(var(--spacing)*1);padding-inline:calc(var(--spacing)*2);&:hover{@media (hover:hover){background-color:var(--color-gray-100)}}}.user-settings input[type=text]{border-color:transparent;border-radius:var(--radius-md);border-style:var(--tw-border-style);border-width:1px;color:var(--color-gray-700);padding-block:calc(var(--spacing)*2);padding-inline:calc(var(--spacing)*3);text-align:right;width:180px;--tw-outline-style:none;outline-style:none}.user-settings input[type=text]:focus,.user-settings input[type=text]:hover{border-color:var(--color-gray-300)}.user-settings select{background-color:var(--color-white);border-color:transparent;border-radius:var(--radius-md);border-style:var(--tw-border-style);border-width:1px;color:var(--color-gray-700);padding-block:calc(var(--spacing)*2);padding-inline:calc(var(--spacing)*3);text-align:right;width:180px;--tw-outline-style:none;outline-style:none}.user-settings select:focus,.user-settings select:hover{border-color:var(--color-gray-300)}.user-settings input[type=color]{border-color:var(--color-gray-300);border-radius:var(--radius-md);border-style:var(--tw-border-style);border-width:1px;height:calc(var(--spacing)*8);padding:calc(var(--spacing)*0);width:80px}.user-settings textarea{border-color:transparent;border-radius:var(--radius-md);border-style:var(--tw-border-style);border-width:1px;color:var(--color-gray-700);padding-block:calc(var(--spacing)*2);padding-inline:calc(var(--spacing)*3);text-align:right;width:100%;--tw-outline-style:none;outline-style:none}.user-settings textarea:focus,.user-settings textarea:hover{border-color:var(--color-gray-300)}.user-settings .switch,.user-settings .toggle-wrap{align-items:center;display:flex;gap:calc(var(--spacing)*2)}.user-settings .toggle-checkbox{-webkit-appearance:none;-moz-appearance:none;appearance:none;background:#e5e5ea;border:1px solid #d1d1d6;border-radius:9999px;box-shadow:inset 0 1px 1px rgba(0,0,0,.1);cursor:pointer;display:inline-block;height:22px;position:relative;transition:background-color .2s ease,border-color .2s ease;width:42px}.user-settings .toggle-checkbox:before{background:#fff;border-radius:9999px;box-shadow:0 2px 4px rgba(0,0,0,.25);content:"";height:18px;left:2px;position:absolute;top:50%;transform:translateY(-50%);transition:transform .2s ease,background-color .2s ease,left .2s ease,right .2s ease;width:18px}.user-settings .toggle-checkbox:checked{background:var(--user-toggle-on-bg,#34c759);border-color:var(--user-toggle-on-bg,#34c759)}.user-settings .panel-title{font-size:20px;--tw-font-weight:var(--font-weight-bold);color:var(--color-gray-800);font-weight:var(--font-weight-bold)}.user-settings .outer-header{align-items:center;background-color:var(--color-gray-100);background:#f2f2f7;border-top-left-radius:var(--radius-xl);border-top-right-radius:var(--radius-xl);display:flex;font-family:var(--font-sans);height:calc(var(--spacing)*11);justify-content:center;position:relative}.user-settings .outer-header .outer-title{font-size:20px;opacity:0;transition:opacity .15s ease;--tw-font-weight:var(--font-weight-bold);color:var(--color-gray-800);font-weight:var(--font-weight-bold)}.user-settings .outer-header.stuck .outer-title{opacity:1}.user-settings .outer-header:after{background:#e5e7eb;bottom:0;content:"";height:1px;left:0;opacity:0;position:absolute;right:0;transition:opacity .15s ease}.user-settings .outer-header.stuck:after{opacity:1}.user-settings .group-title{font-size:13px;padding-inline:calc(var(--spacing)*1);--tw-font-weight:var(--font-weight-semibold);color:var(--color-gray-600);font-weight:var(--font-weight-semibold)}.user-settings .btn-ghost.icon{align-items:center;border-radius:calc(infinity*1px);color:var(--color-gray-500);cursor:pointer;display:flex;font-size:16px;height:calc(var(--spacing)*9);justify-content:center;transition:background-color .15s ease,color .15s ease;-webkit-user-select:none;-moz-user-select:none;user-select:none;width:calc(var(--spacing)*9);&:hover{@media (hover:hover){background-color:var(--color-gray-100)}}&:hover{@media (hover:hover){color:var(--color-gray-700)}}}.user-settings .close-btn:hover{background-color:var(--color-gray-300);box-shadow:0 0 0 1px rgba(0,0,0,.05);color:var(--color-gray-900);font-size:19px;transform:translateY(-50%)}.user-settings .close-btn{position:absolute;right:12px;top:50%;transform:translateY(-50%);transition:transform .15s ease,background-color .15s ease,color .15s ease,font-size .15s ease}.user-settings .toggle-checkbox:checked:before{background:#fff;left:auto;right:2px;transform:translateY(-50%)}.user-settings .color-row{align-items:center;display:flex;gap:calc(var(--spacing)*1.5)}.user-settings .color-swatch{border-radius:var(--radius-md);cursor:pointer;height:calc(var(--spacing)*6);width:calc(var(--spacing)*6)}.user-settings .color-swatch.active{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow);--tw-ring-offset-width:2px;--tw-ring-offset-shadow:var(--tw-ring-inset,) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-color:var(--user-color-ring,#111827)}.user-settings .seg{align-items:center;display:flex;flex-wrap:wrap;gap:calc(var(--spacing)*2)}.user-settings .seg.vertical{align-items:flex-end;flex-direction:column}.user-settings .seg-btn{border-color:var(--color-gray-300);border-radius:var(--radius-md);border-style:var(--tw-border-style);border-width:1px;color:var(--color-gray-700);cursor:pointer;padding-block:calc(var(--spacing)*1);padding-inline:calc(var(--spacing)*3);-webkit-user-select:none;-moz-user-select:none;user-select:none;&:hover{@media (hover:hover){background-color:var(--color-gray-50)}}}.user-settings .seg-btn.active{background:var(--user-active-bg,#111827);border-color:var(--user-active-bg,#111827);color:var(--user-active-fg,#fff)}.user-settings .value-wrap{align-items:flex-end;display:flex;flex-direction:column;gap:calc(var(--spacing)*1);text-align:right}.user-settings .tabs{align-items:center;display:flex;gap:calc(var(--spacing)*2);margin-bottom:calc(var(--spacing)*2)}.user-settings .tab-btn{border-color:var(--color-gray-300);border-radius:var(--radius-md);border-style:var(--tw-border-style);border-width:1px;color:var(--color-gray-700);cursor:pointer;padding-block:calc(var(--spacing)*1);padding-inline:calc(var(--spacing)*3);-webkit-user-select:none;-moz-user-select:none;user-select:none;&:hover{@media (hover:hover){background-color:var(--color-gray-50)}}}.user-settings .tab-btn.active{background:var(--user-active-bg,#111827);border-color:var(--user-active-bg,#111827);color:var(--user-active-fg,#fff)}.user-settings .field-help{color:var(--color-gray-400);font-size:11px}.user-settings .field-help a{color:var(--color-blue-600);text-decoration:underline;text-decoration-style:dashed;text-underline-offset:2px;&:hover{@media (hover:hover){color:var(--color-blue-700)}}}@media (prefers-color-scheme:dark){.user-settings .panel{background-color:var(--color-gray-800);border-bottom-left-radius:var(--radius-xl);border-bottom-right-radius:var(--radius-xl);box-shadow:0 10px 39px 10px #00000040!important;color:var(--color-gray-100)}.user-settings .row{background-color:transparent;border-style:var(--tw-border-style);border-width:0}.user-settings .header-row{background-color:var(--color-gray-800);border-color:var(--color-gray-700)}.user-settings .outer-header{background-color:var(--color-gray-800);border-top-left-radius:var(--radius-xl);border-top-right-radius:var(--radius-xl)}.user-settings .outer-header:after{background:#4b5563}.user-settings .footer a.issue-link{color:var(--color-gray-300);&:hover{@media (hover:hover){color:var(--color-gray-100)}}}.user-settings .footer .brand{color:var(--color-gray-400)}.user-settings label{color:var(--color-gray-300)}.user-settings .field-help{color:var(--color-gray-400)}.user-settings .field-help a{color:var(--color-blue-400);&:hover{@media (hover:hover){color:var(--color-blue-300)}}}.user-settings .group{background-color:var(--color-gray-700)}.user-settings .group .row:not(:last-child):after{background:#4b5563}}.user-settings .panel::-webkit-scrollbar{width:4px}.user-settings .panel::-webkit-scrollbar-track{background:transparent}.user-settings .panel::-webkit-scrollbar-thumb{background:rgba(156,163,175,.25);border-radius:9999px;opacity:.25}.user-settings .footer{align-items:center;color:var(--color-gray-500);display:flex;flex-direction:column;font-size:12px;gap:calc(var(--spacing)*1);padding-bottom:calc(var(--spacing)*3);padding-top:calc(var(--spacing)*6)}.user-settings .footer a.issue-link{color:var(--color-gray-600);cursor:pointer;text-decoration-line:underline;text-underline-offset:2px;-webkit-user-select:none;-moz-user-select:none;user-select:none;&:hover{@media (hover:hover){color:var(--color-gray-800)}}}.user-settings .footer .brand{color:var(--color-gray-500);cursor:pointer;-webkit-user-select:none;-moz-user-select:none;user-select:none;&:hover{@media (hover:hover){color:var(--color-gray-700)}}}.user-settings button{-webkit-user-select:none;-moz-user-select:none;user-select:none}@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-shadow-color{syntax:"*";inherits:false}@property --tw-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-inset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-shadow-color{syntax:"*";inherits:false}@property --tw-inset-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-ring-color{syntax:"*";inherits:false}@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-ring-color{syntax:"*";inherits:false}@property --tw-inset-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-ring-inset{syntax:"*";inherits:false}@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}@property --tw-ring-offset-color{syntax:"*";inherits:false;initial-value:#fff}@property --tw-ring-offset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-font-weight{syntax:"*";inherits:false}@layer properties{*,::backdrop,:after,:before{--tw-shadow:0 0 #0000;--tw-shadow-color:initial;--tw-shadow-alpha:100%;--tw-inset-shadow:0 0 #0000;--tw-inset-shadow-color:initial;--tw-inset-shadow-alpha:100%;--tw-ring-color:initial;--tw-ring-shadow:0 0 #0000;--tw-inset-ring-color:initial;--tw-inset-ring-shadow:0 0 #0000;--tw-ring-inset:initial;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-offset-shadow:0 0 #0000;--tw-border-style:solid;--tw-font-weight:initial}}'
  function isObject(item) {
    return Boolean(item) && typeof item === 'object'
  }
  var currentHost
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      closeSettingsPanel()
    }
  }
  function closeSettingsPanel() {
    try {
      currentHost == null ? void 0 : currentHost.remove()
    } catch (e) {}
    try {
      globalThis.removeEventListener('keydown', onKeyDown, true)
    } catch (e) {}
    currentHost = void 0
  }
  function createFieldRow(opts, content) {
    const row = c('div', { className: 'row', dataset: { key: opts.key } })
    const labWrap = c('div', { className: 'label-wrap' })
    const lab = c('label', { text: opts.label })
    labWrap.append(lab)
    if (opts.help) {
      labWrap.append(c('div', { className: 'field-help', text: opts.help }))
    } else if (opts.renderHelp) {
      const helpEl = c('div', { className: 'field-help' })
      opts.renderHelp(helpEl)
      labWrap.append(helpEl)
    }
    const val = c('div', { className: 'value-wrap' })
    if (Array.isArray(content)) {
      val.append(...content)
    } else {
      val.append(content)
    }
    row.append(labWrap)
    row.append(val)
    return row
  }
  function createToggleRow(opts) {
    const seg = c('div', { className: 'toggle-wrap' })
    const chk = c('input', {
      type: 'checkbox',
      className: 'toggle-checkbox',
      dataset: { key: opts.key, isSitePref: opts.isSitePref ? '1' : '' },
    })
    seg.append(chk)
    const row = createFieldRow(opts, seg)
    return { row, chk }
  }
  function createInputRow(opts) {
    const inp = c('input', {
      type: 'text',
      placeholder: opts.placeholder || '',
      dataset: { key: opts.key, isSitePref: opts.isSitePref ? '1' : '' },
    })
    const row = createFieldRow(opts, inp)
    return { row, inp }
  }
  function createTextareaRow(opts) {
    const ta = c('textarea', {
      rows: opts.rows || 4,
      placeholder: opts.placeholder || '',
      dataset: { key: opts.key, isSitePref: opts.isSitePref ? '1' : '' },
    })
    const row = createFieldRow(opts, ta)
    return { row, ta }
  }
  function createRadioRow(opts) {
    const seg = c('div', { className: 'seg' })
    for (const o of opts.options) {
      const b = c('button', {
        className: 'seg-btn',
        dataset: {
          key: opts.key,
          value: o.value,
          isSitePref: opts.isSitePref ? '1' : '',
        },
        text: o.label,
      })
      seg.append(b)
    }
    const row = createFieldRow(opts, seg)
    return { row, seg }
  }
  function createColorRow(opts) {
    const seg = c('div', { className: 'color-row' })
    for (const o of opts.options) {
      const b = c('button', {
        className: 'color-swatch',
        dataset: {
          key: opts.key,
          value: o.value,
          isSitePref: opts.isSitePref ? '1' : '',
        },
        style: { backgroundColor: o.value },
      })
      seg.append(b)
    }
    const row = createFieldRow(opts, seg)
    return { row, seg }
  }
  function createSelectRow(opts) {
    const sel = c('select', {
      dataset: { key: opts.key, isSitePref: opts.isSitePref ? '1' : '' },
    })
    for (const o of opts.options) {
      const opt = c('option', { value: o.value, text: o.label })
      sel.append(opt)
    }
    const row = createFieldRow(opts, sel)
    return { row, sel }
  }
  function createActionRow(opts) {
    const act = c('div', {
      className: 'seg'.concat(opts.layout === 'vertical' ? ' vertical' : ''),
    })
    for (const a of opts.actions) {
      const b = c('button', {
        className: 'btn action-btn'.concat(
          a.kind === 'danger' ? ' btn-danger' : ''
        ),
        dataset: { key: opts.key, action: a.id },
        text: a.text,
      })
      act.append(b)
    }
    const row = createFieldRow(opts, act)
    return { row }
  }
  function openSettingsPanel(schema, store, options) {
    if (globalThis.self !== globalThis.top) {
      return
    }
    const { host, root, existed } = ensureShadowRoot({
      hostId:
        (options == null ? void 0 : options.hostDatasetValue) || 'settings',
      hostDatasetKey:
        (options == null ? void 0 : options.hostDatasetKey) || 'userHost',
      style: style_default.concat(
        (options == null ? void 0 : options.styleText) || ''
      ),
      moveToEnd: true,
    })
    currentHost = host
    if (existed) return
    let lastValues = { global: {}, site: {} }
    const wrap = c('div', { className: 'user-settings' })
    applyThemeStyles(wrap, options == null ? void 0 : options.theme)
    const panel = c('div', { className: 'panel' })
    const grid = c('div', { className: 'grid' })
    const { row: headerRow } = buildHeader(schema.title)
    grid.append(headerRow)
    const fillers = {}
    const addFiller = (key, fn) => {
      if (!fillers[key]) fillers[key] = []
      fillers[key].push(fn)
    }
    function appendAndFill(container, row, key, filler) {
      container.append(row)
      addFiller(key, filler)
    }
    function appendField(container, f) {
      switch (f.type) {
        case 'toggle': {
          const { row, chk } = createToggleRow({
            label: f.label,
            key: f.key,
            help: f.help,
            renderHelp: f.renderHelp,
            isSitePref: f.isSitePref,
          })
          appendAndFill(container, row, f.key, () => {
            fillToggleUI(chk, f.key)
          })
          break
        }
        case 'input': {
          const { row, inp } = createInputRow({
            label: f.label,
            key: f.key,
            placeholder: f.placeholder,
            help: f.help,
            isSitePref: f.isSitePref,
          })
          appendAndFill(container, row, f.key, () => {
            fillInput(inp, f.key)
          })
          break
        }
        case 'textarea': {
          const { row, ta } = createTextareaRow({
            label: f.label,
            key: f.key,
            rows: f.rows,
            placeholder: f.placeholder,
            help: f.help,
            isSitePref: f.isSitePref,
          })
          appendAndFill(container, row, f.key, () => {
            fillTextarea(ta, f.key)
          })
          break
        }
        case 'radio': {
          const { row, seg } = createRadioRow({
            label: f.label,
            key: f.key,
            options: f.options,
            help: f.help,
            isSitePref: f.isSitePref,
          })
          appendAndFill(container, row, f.key, () => {
            fillRadioUI(seg, f.key)
          })
          break
        }
        case 'select': {
          const { row, sel } = createSelectRow({
            label: f.label,
            key: f.key,
            options: f.options,
            help: f.help,
            isSitePref: f.isSitePref,
          })
          appendAndFill(container, row, f.key, () => {
            fillSelect(sel, f.key)
          })
          break
        }
        case 'colors': {
          const { row, seg } = createColorRow({
            label: f.label,
            key: f.key,
            options: f.options,
            help: f.help,
            isSitePref: f.isSitePref,
          })
          appendAndFill(container, row, f.key, () => {
            fillColorUI(seg, f.key)
          })
          break
        }
        case 'action': {
          const { row } = createActionRow({
            label: f.label,
            key: f.key,
            actions: f.actions,
            help: f.help,
            renderHelp: f.renderHelp,
            layout: f.layout,
          })
          container.append(row)
          break
        }
        case 'custom': {
          if (typeof f.render !== 'function') break
          const rendered = f.render({
            createFieldRow,
            addFiller,
            getFieldValue,
            store,
            options,
          })
          if (rendered && rendered.row) {
            container.append(rendered.row)
          }
          if (rendered && Array.isArray(rendered.fillers)) {
            for (const filler of rendered.fillers) {
              if (!filler || typeof filler.fn !== 'function') continue
              addFiller(filler.key || '*', filler.fn)
            }
          }
          break
        }
      }
    }
    function applyThemeStyles(wrap2, theme) {
      if (!theme) return
      const properties = []
      if (theme.activeBg)
        properties.push('--user-active-bg: '.concat(theme.activeBg, ';'))
      if (theme.activeFg)
        properties.push('--user-active-fg: '.concat(theme.activeFg, ';'))
      if (theme.colorRing)
        properties.push('--user-color-ring: '.concat(theme.colorRing, ';'))
      if (theme.toggleOnBg)
        properties.push('--user-toggle-on-bg: '.concat(theme.toggleOnBg, ';'))
      const accent = theme.activeBg || theme.colorRing
      if (accent) properties.push('--user-accent: '.concat(accent, ';'))
      if (properties.length > 0) wrap2.style.cssText = properties.join(' ')
    }
    function buildHeader(title) {
      const row = c('div', { className: 'row header-row' })
      const titleEl = c('label', { className: 'panel-title', text: title })
      row.append(titleEl)
      return { row }
    }
    function renderSimplePanel(container, data) {
      if (data.groups && Array.isArray(data.groups)) {
        renderGroupsPanel(container, data.groups)
        return
      }
      const fields = data.fields || []
      const body = c('div', { className: 'grid group' })
      container.append(body)
      for (const f of fields) appendField(body, f)
    }
    function renderTabsPanel(container, tabs) {
      var _a
      const tabsWrap = c('div', { className: 'tabs' })
      const panels = {}
      let active = ((_a = tabs[0]) == null ? void 0 : _a.id) || ''
      for (const t2 of tabs) {
        const b = c('button', {
          className: 'tab-btn',
          dataset: { tabId: t2.id },
          text: t2.title,
        })
        tabsWrap.append(b)
        const p = c('div', { className: 'grid' })
        panels[t2.id] = p
        if (t2.id !== active) p.style.display = 'none'
        if ('groups' in t2 && Array.isArray(t2.groups)) {
          renderGroupsPanel(p, t2.groups)
        } else if ('fields' in t2 && Array.isArray(t2.fields)) {
          p.className = 'grid group'
          for (const f of t2.fields) appendField(p, f)
        }
      }
      container.append(tabsWrap)
      for (const id of Object.keys(panels)) container.append(panels[id])
      function updateTabsUI() {
        for (const b of Array.from(tabsWrap.querySelectorAll('.tab-btn'))) {
          const id = b.dataset.tabId || ''
          if (id === active) b.classList.add('active')
          else b.classList.remove('active')
        }
        for (const id of Object.keys(panels)) {
          panels[id].style.display = id === active ? '' : 'none'
        }
      }
      function onTabsClick(e) {
        const t2 = e.target
        const b = t2.closest('.tab-btn')
        if (b && b instanceof HTMLElement) {
          active = b.dataset.tabId || ''
          updateTabsUI()
        }
      }
      tabsWrap.addEventListener('click', onTabsClick)
      updateTabsUI()
    }
    function renderGroupsPanel(container, groups) {
      for (const g of groups) {
        const body = c('div', { className: 'grid group' })
        if (g.title) {
          const header = c('h2', { className: 'group-title', text: g.title })
          container.append(header)
        }
        container.append(body)
        for (const f of g.fields) appendField(body, f)
      }
    }
    const refreshAll = async () => {
      try {
        const g = await store.getAll(true)
        const s = await store.getAll(false)
        lastValues = { global: g, site: s }
      } catch (e) {}
      for (const k of Object.keys(fillers)) {
        for (const fn of fillers[k]) {
          try {
            fn()
          } catch (e) {}
        }
      }
    }
    function wireStoreChange(store2, fillers2) {
      var _a
      try {
        ;(_a = store2.onChange) == null
          ? void 0
          : _a.call(store2, (e) => {
              if (e.key === '*' || !fillers2[e.key]) {
                void refreshAll()
                return
              }
              for (const fn of fillers2[e.key]) {
                try {
                  fn()
                } catch (e2) {}
              }
            })
      } catch (e) {}
    }
    function getFieldValue(key, el) {
      const isSitePref = Boolean(el.dataset.isSitePref)
      const values = isSitePref ? lastValues.site : lastValues.global
      if (values[key] !== void 0) return values[key]
      return CURRENT_SETTINGS[key]
    }
    function getFieldInfo(el) {
      const key = el.dataset.key
      if (!key) return null
      const isSitePref = Boolean(el.dataset.isSitePref)
      return { key, isSitePref }
    }
    function fillRadioUI(seg, key) {
      try {
        const btn = seg.querySelector('.seg-btn')
        if (!btn) return
        const v = getFieldValue(key, btn)
        for (const b of Array.from(seg.querySelectorAll('.seg-btn'))) {
          const val = b.dataset.value || ''
          if (val === String(v)) b.classList.add('active')
          else b.classList.remove('active')
        }
      } catch (e) {}
    }
    function fillColorUI(seg, key) {
      try {
        const btn = seg.querySelector('.color-swatch')
        if (!btn) return
        const v = getFieldValue(key, btn)
        for (const b of Array.from(seg.querySelectorAll('.color-swatch'))) {
          const val = b.dataset.value || ''
          if (val.toLowerCase() === String(v || '').toLowerCase())
            b.classList.add('active')
          else b.classList.remove('active')
        }
      } catch (e) {}
    }
    function fillToggleUI(onBtn, key) {
      try {
        if (onBtn instanceof HTMLInputElement && onBtn.type === 'checkbox') {
          const v = getFieldValue(key, onBtn)
          onBtn.checked = Boolean(v)
        }
      } catch (e) {}
    }
    function fillInput(inp, key) {
      try {
        const v = getFieldValue(key, inp)
        inp.value = String(v != null ? v : '')
      } catch (e) {}
    }
    function fillTextarea(ta, key) {
      try {
        const v = getFieldValue(key, ta)
        ta.value = String(v != null ? v : '')
      } catch (e) {}
    }
    function fillSelect(sel, key) {
      try {
        const v = getFieldValue(key, sel)
        for (const o of Array.from(sel.querySelectorAll('option'))) {
          o.selected = o.value === String(v)
        }
      } catch (e) {}
    }
    async function handleSegButton(rb) {
      const info = getFieldInfo(rb)
      if (!info) return
      const val = rb.dataset.value || ''
      try {
        await store.set(info.key, val, !info.isSitePref)
      } catch (e) {}
    }
    async function handleColorSwatch(cs) {
      const info = getFieldInfo(cs)
      if (!info) return
      const val = cs.dataset.value || ''
      try {
        await store.set(info.key, val, !info.isSitePref)
      } catch (e) {}
    }
    function handleActionBtn(ab) {
      var _a
      const key = ab.dataset.key || ''
      const actionId = ab.dataset.action || ''
      try {
        ;(_a = options == null ? void 0 : options.onAction) == null
          ? void 0
          : _a.call(options, { key, actionId, target: ab })
      } catch (e) {}
    }
    function onPanelClick(e) {
      const t2 = e.target
      if (t2 === topCloseBtn) {
        closeSettingsPanel()
        return
      }
      const rb = t2.closest('.seg-btn')
      if (rb && rb instanceof HTMLElement) {
        void handleSegButton(rb)
        return
      }
      const cs = t2.closest('.color-swatch')
      if (cs && cs instanceof HTMLElement) {
        void handleColorSwatch(cs)
        return
      }
      const ab = t2.closest('.action-btn')
      if (ab && ab instanceof HTMLElement) handleActionBtn(ab)
    }
    function handleInputChange(inp) {
      const info = getFieldInfo(inp)
      if (!info) return
      const isCheckbox = (inp.type || '').toLowerCase() === 'checkbox'
      const v = isCheckbox ? Boolean(inp.checked) : inp.value
      void store.set(info.key, v, !info.isSitePref)
    }
    function handleTextareaChange(ta) {
      const info = getFieldInfo(ta)
      if (!info) return
      void store.set(info.key, ta.value, !info.isSitePref)
    }
    function handleSelectChange(sel) {
      const info = getFieldInfo(sel)
      if (!info) return
      void store.set(info.key, sel.value, !info.isSitePref)
    }
    function onPanelChange(e) {
      const t2 = e.target
      const inp = t2.closest('input')
      if (inp && inp instanceof HTMLInputElement) {
        handleInputChange(inp)
        return
      }
      const ta = t2.closest('textarea')
      if (ta && ta instanceof HTMLTextAreaElement) {
        handleTextareaChange(ta)
        return
      }
      const sel = t2.closest('select')
      if (sel && sel instanceof HTMLSelectElement) {
        handleSelectChange(sel)
      }
    }
    switch (schema.type) {
      case 'simple': {
        renderSimplePanel(grid, schema)
        break
      }
      case 'tabs': {
        renderTabsPanel(grid, schema.tabs)
        break
      }
    }
    panel.addEventListener('click', onPanelClick)
    panel.addEventListener('change', onPanelChange)
    const outerHeader = c('div', { className: 'outer-header' })
    const outerTitle = c('label', {
      className: 'outer-title',
      text: schema.title,
    })
    const topCloseBtn = c('button', {
      className: 'btn-ghost icon close-btn',
      text: '\xD7',
      attrs: { 'aria-label': t('aria_close') || 'Close' },
    })
    outerHeader.append(outerTitle)
    outerHeader.append(topCloseBtn)
    try {
      outerHeader.addEventListener('click', (e) => {
        const t2 = e.target
        if (t2 === topCloseBtn) {
          closeSettingsPanel()
        }
      })
    } catch (e) {}
    panel.append(grid)
    const issueLink = c('a', {
      className: 'issue-link',
      text: t('text_report_issue') || 'Report an Issue…',
      attrs: {
        href:
          (options == null ? void 0 : options.issuesUrl) ||
          'https://github.com/utags/userscripts/issues',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    })
    const brand = c('a', {
      className: 'brand',
      text: t('text_brand') || 'Made with \u2764\uFE0F by Pipecraft',
      attrs: {
        href: 'https://www.pipecraft.net/',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    })
    const stickyThreshold = 22
    let stickyTimer
    const stickyDebounceMs = 80
    function updateHeaderStickyCore() {
      try {
        const sc = panel.scrollTop || 0
        const stuck = sc > stickyThreshold
        if (stuck) {
          panel.classList.add('panel-stuck')
          outerHeader.classList.add('stuck')
        } else {
          panel.classList.remove('panel-stuck')
          outerHeader.classList.remove('stuck')
        }
      } catch (e) {}
    }
    function updateHeaderSticky() {
      try {
        if (stickyTimer !== void 0) globalThis.clearTimeout(stickyTimer)
        stickyTimer = globalThis.setTimeout(
          updateHeaderStickyCore,
          stickyDebounceMs
        )
      } catch (e) {}
    }
    try {
      panel.addEventListener('scroll', updateHeaderSticky)
      updateHeaderStickyCore()
    } catch (e) {}
    wrap.append(outerHeader)
    wrap.append(panel)
    root.append(wrap)
    wireStoreChange(store, fillers)
    void refreshAll()
    globalThis.addEventListener('keydown', onKeyDown, true)
  }
  function createSettingsStore(
    storageKey,
    defaults,
    isSupportSitePref = false
  ) {
    const rootKey = storageKey || 'settings'
    let cache
    let globalCache
    let siteCache
    let initPromise
    const changeCbs = []
    let listenerRegistered = false
    const getHostname = () => {
      var _a
      return (
        ((_a = globalThis.location) == null ? void 0 : _a.hostname) || 'unknown'
      )
    }
    const isScopedSettingsShape = (obj) => {
      if (!isObject(obj)) return false
      if (isObject(obj.global)) return true
      for (const k of Object.keys(obj)) {
        if (k === 'global') return true
        if (isObject(obj[k])) return true
      }
      return false
    }
    let beforeSetHook
    function updateCache(obj) {
      if (isSupportSitePref) {
        const rootObj = isObject(obj) ? obj : {}
        const scopedShape = isScopedSettingsShape(rootObj)
        const globalData = scopedShape ? rootObj.global : rootObj
        globalCache = __spreadValues({}, defaults)
        if (isObject(globalData)) {
          Object.assign(globalCache, globalData)
        }
        const hostname = getHostname()
        const siteData = scopedShape ? rootObj[hostname] : void 0
        siteCache = __spreadValues({}, globalCache)
        if (isObject(siteData)) {
          Object.assign(siteCache, siteData)
        }
        cache = siteCache
      } else {
        cache = __spreadValues({}, defaults)
        if (isObject(obj)) Object.assign(cache, obj)
      }
    }
    function registerValueChangeListener() {
      if (listenerRegistered) return
      try {
        void addValueChangeListener(rootKey, (n, ov, nv, remote) => {
          try {
            updateCache(nv)
            for (const f of changeCbs) {
              f({ key: '*', oldValue: ov, newValue: nv, remote })
            }
          } catch (e) {}
        })
        listenerRegistered = true
      } catch (e) {}
    }
    registerValueChangeListener()
    async function ensure() {
      if (cache) return cache
      if (initPromise) return initPromise
      initPromise = (async () => {
        let obj
        try {
          obj = await getValue(rootKey, void 0)
        } catch (e) {}
        updateCache(obj)
        initPromise = void 0
        return cache
      })()
      return initPromise
    }
    return {
      async get(key, isGlobalPref) {
        await ensure()
        if (isSupportSitePref) {
          if (isGlobalPref) return globalCache[key]
          return siteCache[key]
        }
        return cache[key]
      },
      async getAll(isGlobalPref) {
        await ensure()
        if (isSupportSitePref) {
          if (isGlobalPref) return __spreadValues({}, globalCache)
          return __spreadValues({}, siteCache)
        }
        return __spreadValues({}, cache)
      },
      async set(...args) {
        let obj
        try {
          obj = await getValue(rootKey, {})
        } catch (e) {}
        if (!isObject(obj)) obj = {}
        if (isSupportSitePref && !isScopedSettingsShape(obj)) {
          obj = { global: __spreadValues({}, obj) }
        }
        let isGlobalPref = false
        let values = {}
        if (typeof args[0] === 'string') {
          values[args[0]] = args[1]
          isGlobalPref = Boolean(args[2])
        } else {
          values = __spreadValues({}, args[0])
          isGlobalPref = Boolean(args[1])
        }
        if (beforeSetHook) {
          try {
            values = await beforeSetHook(values, isGlobalPref)
          } catch (e) {}
        }
        let target
        let global
        if (isSupportSitePref) {
          const hostname = isGlobalPref ? 'global' : getHostname()
          if (!isObject(obj[hostname])) obj[hostname] = {}
          target = obj[hostname]
          global = isObject(obj.global) ? obj.global : {}
        } else {
          target = obj
        }
        const isSitePref = isSupportSitePref && !isGlobalPref
        const apply = (key, value) => {
          if (!(key in defaults)) {
            if (value === void 0 || value === null || value === '') {
              delete target[key]
            } else {
              target[key] = value
            }
            return
          }
          if (isSitePref && key in global) {
            const normalized = normalizeToDefaultType(value, defaults[key])
            target[key] = normalized
            return
          }
          setOrDelete(target, key, value, defaults[key])
        }
        if (values) {
          for (const k of Object.keys(values)) {
            const v = values[k]
            apply(k, v)
          }
        }
        if (isSupportSitePref && target && Object.keys(target).length === 0) {
          const hostname = isGlobalPref ? 'global' : getHostname()
          delete obj[hostname]
        }
        updateCache(obj)
        try {
          await setValue(rootKey, obj)
        } catch (e) {}
      },
      async reset(isGlobalPref) {
        let obj
        if (isSupportSitePref) {
          try {
            obj = await getValue(rootKey, {})
          } catch (e) {}
          if (!isObject(obj)) obj = {}
          if (!isScopedSettingsShape(obj)) {
            obj = { global: __spreadValues({}, obj) }
          }
          const hostname = isGlobalPref ? 'global' : getHostname()
          delete obj[hostname]
        } else {
          obj = {}
        }
        updateCache(obj)
        try {
          await setValue(rootKey, obj)
        } catch (e) {}
      },
      defaults() {
        return __spreadValues({}, defaults)
      },
      onChange(cb) {
        changeCbs.push(cb)
      },
      onBeforeSet(cb) {
        beforeSetHook = cb
      },
    }
  }
  var win = globalThis
  function extractDomain(url) {
    try {
      let hostname
      if (url) {
        try {
          hostname = new URL(url).hostname
        } catch (e) {
          hostname = String(url)
        }
      } else {
        hostname = win.location.hostname
      }
      let raw = String(hostname || '').toLowerCase().trim()
      if (!raw) return ''
      raw = raw.replace(/\.$/, '')
      if (raw.startsWith('[') && raw.endsWith(']')) {
        raw = raw.slice(1, -1)
      }
      if (raw.includes(':') && !raw.includes('.')) {
        return raw
      }
      raw = raw.split(':')[0]
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw
      if (raw === 'localhost') return raw
      const domain = raw.replace(/^www\./, '')
      const parts = domain.split('.').filter(Boolean)
      if (parts.length <= 2) return domain
      const secondLevelDomains = ['ac', 'co', 'com', 'edu', 'gov', 'mil', 'net', 'org']
      const tld = parts[parts.length - 1]
      const sld = parts[parts.length - 2]
      const isCountryTld = tld.length === 2
      if (isCountryTld && secondLevelDomains.includes(sld)) {
        return parts.slice(-3).join('.')
      }
      return parts.slice(-2).join('.')
    } catch (e) {
      return url || win.location.hostname || ''
    }
  }
  function resolveSearchContext(url) {
    let hostname = ''
    try {
      if (url) {
        try {
          hostname = new URL(url).hostname
        } catch (e) {
          hostname = String(url)
        }
      } else {
        hostname = win.location.hostname
      }
    } catch (e) {}
    hostname = String(hostname || '').toLowerCase().trim().replace(/\.$/, '')
    const searchDomain = extractDomain(hostname) || hostname
    const countDomain = getBestMatchDomain(hostname, gfData, sfData) || searchDomain
    return { hostname, searchDomain, countDomain }
  }
  function getCurrentSelectionText() {
    try {
      const selection = globalThis.getSelection ? globalThis.getSelection() : null
      if (!selection) return ''
      return String(selection.toString() || '').replace(/\s+/g, ' ').trim()
    } catch (e) {
      return ''
    }
  }
  var KEYWORD_SOURCE_MODES = [
    'domain',
    'hostname',
    'title',
    'selection',
    'manual',
  ]
  function normalizeBoolean(value, defaultValue = false) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const v = value.toLowerCase().trim()
      if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
      if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
    }
    if (typeof value === 'number') return value !== 0
    return defaultValue
  }
  function normalizeKeywordSourceMode(value) {
    const mode = String(value || 'domain')
    return KEYWORD_SOURCE_MODES.includes(mode) ? mode : 'domain'
  }
  function normalizeAggregateDelay(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return 120
    if (n < 0) return 0
    if (n > 2e3) return 2e3
    return Math.round(n)
  }
  function normalizeManualKeyword(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  function normalizeCustomRepositoriesJson(value) {
    return String(value || '').trim()
  }
  function normalizeSettingsPatch(values) {
    const out = isObject(values) ? __spreadValues({}, values) : {}
    if ('menu_preset_id' in out) {
      out.menu_preset_id = normalizeMenuPresetId(out.menu_preset_id)
      if (out.menu_preset_id !== 'custom') {
        out.quick_menu_entries = buildPresetQuickEntries(
          out.menu_preset_id,
          CURRENT_REPOSITORIES
        )
      }
    }
    if ('quick_menu_entries' in out) {
      out.quick_menu_entries = normalizeQuickMenuEntries(
        out.quick_menu_entries,
        CURRENT_REPOSITORIES
      )
      if (!('menu_preset_id' in out)) {
        out.menu_preset_id = 'custom'
      }
    }
    if ('keyword_source_mode' in out) {
      out.keyword_source_mode = normalizeKeywordSourceMode(
        out.keyword_source_mode
      )
    }
    if ('keyword_manual_text' in out) {
      out.keyword_manual_text = normalizeManualKeyword(out.keyword_manual_text)
    }
    if ('aggregate_domain_enabled' in out) {
      out.aggregate_domain_enabled = normalizeBoolean(
        out.aggregate_domain_enabled,
        true
      )
    }
    if ('aggregate_keyword_enabled' in out) {
      out.aggregate_keyword_enabled = normalizeBoolean(
        out.aggregate_keyword_enabled,
        true
      )
    }
    if ('aggregate_open_background' in out) {
      out.aggregate_open_background = normalizeBoolean(
        out.aggregate_open_background,
        false
      )
    }
    if ('aggregate_open_delay_ms' in out) {
      out.aggregate_open_delay_ms = normalizeAggregateDelay(
        out.aggregate_open_delay_ms
      )
    }
    if ('enable_shortcut' in out) {
      out.enable_shortcut = normalizeBoolean(out.enable_shortcut, true)
    }
    if ('debug_enabled' in out) {
      out.debug_enabled = normalizeBoolean(out.debug_enabled, false)
    }
    if ('custom_repositories_json' in out) {
      out.custom_repositories_json = normalizeCustomRepositoriesJson(
        out.custom_repositories_json
      )
    }
    out.settings_version = SETTINGS_VERSION
    return out
  }
  function normalizeSettingsObject(
    settings,
    repositories = CURRENT_REPOSITORIES
  ) {
    const defaults = buildDefaults(repositories)
    const merged = __spreadValues(
      __spreadValues({}, defaults),
      isObject(settings) ? settings : {}
    )
    merged.settings_version = SETTINGS_VERSION
    merged.menu_preset_id = normalizeMenuPresetId(merged.menu_preset_id)
    if (merged.menu_preset_id !== 'custom') {
      merged.quick_menu_entries = buildPresetQuickEntries(
        merged.menu_preset_id,
        repositories
      )
    } else {
      merged.quick_menu_entries = normalizeQuickMenuEntries(
        merged.quick_menu_entries,
        repositories
      )
    }
    merged.keyword_source_mode = normalizeKeywordSourceMode(merged.keyword_source_mode)
    merged.keyword_manual_text = normalizeManualKeyword(merged.keyword_manual_text)
    merged.aggregate_domain_enabled = normalizeBoolean(
      merged.aggregate_domain_enabled,
      true
    )
    merged.aggregate_keyword_enabled = normalizeBoolean(
      merged.aggregate_keyword_enabled,
      true
    )
    merged.aggregate_open_background = normalizeBoolean(
      merged.aggregate_open_background,
      false
    )
    merged.aggregate_open_delay_ms = normalizeAggregateDelay(
      merged.aggregate_open_delay_ms
    )
    merged.enable_shortcut = normalizeBoolean(merged.enable_shortcut, true)
    merged.debug_enabled = normalizeBoolean(merged.debug_enabled, false)
    merged.custom_repositories_json = normalizeCustomRepositoriesJson(
      merged.custom_repositories_json
    )
    return merged
  }
  function resolveKeyword(settings, context) {
    const mode = normalizeKeywordSourceMode(
      settings == null ? void 0 : settings.keyword_source_mode
    )
    const manualText = normalizeManualKeyword(
      settings == null ? void 0 : settings.keyword_manual_text
    )
    const pageTitle = String((doc == null ? void 0 : doc.title) || '')
      .replace(/\s+/g, ' ')
      .trim()
    const selectionText = getCurrentSelectionText()
    let keyword = ''
    switch (mode) {
      case 'hostname':
        keyword = context.hostname
        break
      case 'title':
        keyword = pageTitle
        break
      case 'selection':
        keyword = selectionText
        break
      case 'manual':
        keyword = manualText
        break
      case 'domain':
      default:
        keyword = context.searchDomain
        break
    }
    keyword = String(keyword || '').replace(/\s+/g, ' ').trim()
    if (!keyword) keyword = context.searchDomain || context.hostname || ''
    return keyword
  }
  var CONFIG = {
    REPOSITORIES: [
      {
        id: 'greasy_fork',
        name: 'Greasy Fork',
        domainSearchUrl:
          'https://greasyfork.org/scripts/by-site/{domain}?filter_locale=0',
        domainSearchEnabled: true,
        keywordSearchUrl:
          'https://greasyfork.org/scripts?filter_locale=0&q={keyword}',
        keywordSearchEnabled: true,
        icon: '\u{1F374}',
      },
      {
        id: 'openuserjs',
        name: 'OpenUserJS',
        keywordSearchUrl: 'https://openuserjs.org/?q={keyword}',
        keywordSearchEnabled: true,
        icon: '\u{1F4DC}',
      },
      {
        id: 'scriptcat',
        name: 'ScriptCat',
        domainSearchUrl: 'https://scriptcat.org/search?domain={domain}',
        domainSearchEnabled: true,
        keywordSearchUrl: 'https://scriptcat.org/search?keyword={keyword}',
        keywordSearchEnabled: true,
        icon: '\u{1F431}',
      },
      {
        id: 'github',
        name: 'GitHub',
        keywordSearchUrl:
          'https://github.com/search?type=code&q=language%3AJavaScript+%22%3D%3DUserScript%3D%3D%22+{keyword}',
        keywordSearchEnabled: true,
        icon: '\u{1F419}',
      },
      {
        id: 'github_gist',
        name: 'GitHub Gist',
        keywordSearchUrl:
          'https://gist.github.com/search?l=JavaScript&q=%22%3D%3DUserScript%3D%3D%22+{keyword}',
        keywordSearchEnabled: true,
        icon: '\u{1F4DD}',
      },
      {
        id: 'sleazy_fork',
        name: 'Sleazy Fork',
        domainSearchUrl:
          'https://sleazyfork.org/scripts/by-site/{domain}?filter_locale=0',
        domainSearchEnabled: false,
        keywordSearchUrl:
          'https://sleazyfork.org/scripts?filter_locale=0&q={keyword}',
        keywordSearchEnabled: false,
        icon: '\u{1F51E}',
      },
    ],
    DEBUG: false,
  }
  var CURRENT_REPOSITORIES = CONFIG.REPOSITORIES.slice()
  var CUSTOM_REPO_MAX = 30
  function normalizeRepoId(value, fallback = 'custom_repo') {
    const base = String(value || fallback)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
    return base || fallback
  }
  function normalizeRepoName(value, fallback = 'Custom Repo') {
    const name = String(value || '').trim()
    return name || fallback
  }
  function normalizeRepoIcon(value, fallback = '\u{1F9E9}') {
    const icon = String(value || '').trim()
    return icon || fallback
  }
  function normalizeRepoTemplate(value) {
    const url = String(value || '').trim()
    if (!url) return ''
    if (/^https?:\/\//i.test(url)) return url
    return ''
  }
  function parseCustomRepositories(rawJson) {
    const text = normalizeCustomRepositoriesJson(rawJson)
    if (!text) return []
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      debugLog('Invalid custom repository JSON', e)
      return []
    }
    if (!Array.isArray(parsed)) return []
    const usedIds = new Set(CONFIG.REPOSITORIES.map((repo) => repo.id))
    const customRepos = []
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i]
      if (!isObject(item)) continue
      const name = normalizeRepoName(item.name, 'Custom Repo '.concat(i + 1))
      let id = normalizeRepoId(item.id, 'custom_repo_'.concat(i + 1))
      while (usedIds.has(id)) {
        id = ''.concat(id, '_').concat(i + 1)
      }
      const domainSearchUrl = normalizeRepoTemplate(item.domainSearchUrl)
      const keywordSearchUrl = normalizeRepoTemplate(item.keywordSearchUrl)
      if (!domainSearchUrl && !keywordSearchUrl) continue
      usedIds.add(id)
      customRepos.push({
        id,
        name,
        icon: normalizeRepoIcon(item.icon),
        domainSearchUrl,
        keywordSearchUrl,
        domainSearchEnabled:
          Boolean(domainSearchUrl) && normalizeBoolean(item.domainSearchEnabled, true),
        keywordSearchEnabled:
          Boolean(keywordSearchUrl) && normalizeBoolean(item.keywordSearchEnabled, true),
      })
      if (customRepos.length >= CUSTOM_REPO_MAX) break
    }
    return customRepos
  }
  function rebuildRepositories(settings) {
    const customRepos = parseCustomRepositories(
      settings == null ? void 0 : settings.custom_repositories_json
    )
    CURRENT_REPOSITORIES = CONFIG.REPOSITORIES.concat(customRepos)
    return CURRENT_REPOSITORIES
  }
  function applyRepositorySettingDefaults(settings, repositories) {
    const out = __spreadValues({}, settings)
    for (const repo of repositories) {
      if (repo.domainSearchUrl) {
        const key = 'domain_'.concat(repo.id)
        if (typeof out[key] !== 'boolean') {
          out[key] = Boolean(repo.domainSearchEnabled)
        }
      }
      if (repo.keywordSearchUrl) {
        const key = 'keyword_'.concat(repo.id)
        if (typeof out[key] !== 'boolean') {
          out[key] = Boolean(repo.keywordSearchEnabled)
        }
      }
    }
    return out
  }
  var SETTINGS_VERSION = 2
  var MENU_PRESET_IDS = ['recommended', 'common', 'full', 'custom']
  function normalizeMenuPresetId(value) {
    const presetId = String(value || 'recommended').trim()
    return MENU_PRESET_IDS.includes(presetId) ? presetId : 'recommended'
  }
  function createQuickEntryId(mode, repoId) {
    return ''.concat(mode, ':').concat(repoId)
  }
  function parseQuickEntryId(value) {
    const raw = String(value || '').trim()
    if (!raw) return { type: 'unknown', raw: '' }
    if (raw === 'aggregate:domain') {
      return { type: 'aggregate', mode: 'domain', raw }
    }
    if (raw === 'aggregate:keyword') {
      return { type: 'aggregate', mode: 'keyword', raw }
    }
    if (raw === 'panel:more') {
      return { type: 'panel', panel: 'more', raw }
    }
    const parts = raw.split(':')
    if (parts.length === 2 && (parts[0] === 'domain' || parts[0] === 'keyword')) {
      return { type: 'repo', mode: parts[0], repoId: parts[1], raw }
    }
    return { type: 'unknown', raw }
  }
  function buildQuickEntryDefinitions(repositories = CURRENT_REPOSITORIES) {
    const entries = []
    for (const repo of repositories) {
      if (repo.domainSearchUrl) {
        entries.push({
          id: createQuickEntryId('domain', repo.id),
          type: 'repo',
          mode: 'domain',
          repoId: repo.id,
        })
      }
      if (repo.keywordSearchUrl) {
        entries.push({
          id: createQuickEntryId('keyword', repo.id),
          type: 'repo',
          mode: 'keyword',
          repoId: repo.id,
        })
      }
    }
    entries.push({ id: 'aggregate:domain', type: 'aggregate', mode: 'domain' })
    entries.push({ id: 'aggregate:keyword', type: 'aggregate', mode: 'keyword' })
    entries.push({ id: 'panel:more', type: 'panel', panel: 'more' })
    return entries
  }
  function buildQuickEntryMap(repositories = CURRENT_REPOSITORIES) {
    const out = {}
    for (const item of buildQuickEntryDefinitions(repositories)) {
      out[item.id] = item
    }
    return out
  }
  function buildPresetQuickEntries(presetId, repositories = CURRENT_REPOSITORIES) {
    const defs = buildQuickEntryMap(repositories)
    const preferred = {
      recommended: ['domain:greasy_fork', 'keyword:greasy_fork', 'panel:more'],
      common: [
        'domain:greasy_fork',
        'keyword:greasy_fork',
        'keyword:scriptcat',
        'panel:more',
      ],
    }
    if (presetId === 'full') {
      const all = []
      for (const repo of repositories) {
        if (repo.domainSearchUrl) all.push(createQuickEntryId('domain', repo.id))
        if (repo.keywordSearchUrl) all.push(createQuickEntryId('keyword', repo.id))
      }
      all.push('aggregate:domain', 'aggregate:keyword', 'panel:more')
      return all.filter((item, index) => defs[item] && all.indexOf(item) === index)
    }
    const presetEntries = preferred[presetId] || preferred.recommended
    return presetEntries.filter((item, index) => defs[item] && presetEntries.indexOf(item) === index)
  }
  function normalizeQuickMenuEntries(value, repositories = CURRENT_REPOSITORIES) {
    const defs = buildQuickEntryMap(repositories)
    let entries = value
    if (typeof entries === 'string') {
      const raw = entries.trim()
      if (!raw) {
        entries = []
      } else {
        try {
          entries = JSON.parse(raw)
        } catch (e) {
          entries = raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        }
      }
    }
    if (!Array.isArray(entries)) entries = []
    const normalized = []
    for (const item of entries) {
      const id = String(item || '').trim()
      if (!id || !defs[id] || normalized.includes(id)) continue
      normalized.push(id)
    }
    if (normalized.length > 0) return normalized
    return buildPresetQuickEntries('recommended', repositories)
  }
  function findRepositoryById(repoId, repositories = CURRENT_REPOSITORIES) {
    return repositories.find((repo) => repo.id === repoId) || null
  }
  function getQuickEntryDisplayLabel(entryId, repositories = CURRENT_REPOSITORIES) {
    const parsed = parseQuickEntryId(entryId)
    if (parsed.type === 'repo') {
      const repo = findRepositoryById(parsed.repoId, repositories)
      if (!repo) return entryId
      const suffix =
        parsed.mode === 'domain'
          ? t('text_mode_domain_short') || 'Domain'
          : t('text_mode_keyword_short') || 'Keyword'
      return ''.concat(repo.icon, ' ').concat(repo.name, ' · ').concat(suffix)
    }
    if (parsed.type === 'aggregate') {
      return parsed.mode === 'domain'
        ? t('entry_aggregate_domain') || 'All repos · Domain'
        : t('entry_aggregate_keyword') || 'All repos · Keyword'
    }
    if (parsed.type === 'panel') {
      return t('menu_more_search') || 'More Search…'
    }
    return entryId
  }
  function resolveRepoSearchEnabled(repo, mode, settings) {
    const key = ''.concat(mode, '_').concat(repo.id)
    const explicit = settings == null ? void 0 : settings[key]
    if (typeof explicit === 'boolean') return explicit
    if (mode === 'domain') return Boolean(repo.domainSearchEnabled)
    return Boolean(repo.keywordSearchEnabled)
  }
  function buildSearchUrl(template, token, value) {
    const encoded = encodeURIComponent(String(value || ''))
    if (template.includes(token)) {
      return template.replace(token, encoded)
    }
    const joiner = template.includes('?') ? '&' : '?'
    const key = token === '{domain}' ? 'domain' : 'q'
    return ''.concat(template).concat(joiner).concat(key, '=').concat(encoded)
  }
  var I18N = {
    en: {
      menu_domain: '{icon} Find scripts by domain on {name}',
      menu_keyword: '{icon} Find scripts by keyword on {name}',
      menu_aggregate_domain: '\u{1F517} Search all enabled repos by domain ({count})',
      menu_aggregate_keyword: '\u{1F517} Search all enabled repos by keyword ({count})',
      title_settings: 'Repository Settings',
      btn_save: 'Save',
      btn_cancel: 'Cancel',
      title_domain: 'Domain Search',
      title_keyword: 'Keyword Search',
      title_domain_global: 'Domain Search (Global)',
      title_keyword_global: 'Keyword Search (Global)',
      title_domain_site: 'Domain Search (Current Site)',
      title_keyword_site: 'Keyword Search (Current Site)',
      title_aggregate: 'Aggregate Search',
      title_custom_repos: 'Custom Repositories',
      title_data: 'Data Management',
      title_scope_actions: 'Scope Actions',
      tab_global: 'Global',
      tab_site: 'Site',
      tab_advanced: 'Advanced',
      label_keyword_source: 'Keyword Source',
      label_keyword_manual: 'Manual Keyword',
      placeholder_keyword_manual: 'Enter keyword for manual mode',
      help_keyword_manual: 'Only used when keyword source is Manual',
      keyword_source_domain: 'Use domain',
      keyword_source_hostname: 'Use hostname',
      keyword_source_title: 'Use page title',
      keyword_source_selection: 'Use selected text',
      keyword_source_manual: 'Use manual text',
      label_aggregate_domain: 'Enable aggregate domain menu',
      label_aggregate_keyword: 'Enable aggregate keyword menu',
      label_aggregate_background: 'Open aggregate tabs in background',
      label_aggregate_delay: 'Aggregate open delay (ms)',
      help_aggregate_delay: 'Delay between opening tabs (0-2000 ms)',
      label_custom_repos: 'Custom repositories (JSON array)',
      placeholder_custom_repos:
        '[{"id":"my_repo","name":"My Repo","icon":"\u{1F680}","domainSearchUrl":"https://example.com/search?d={domain}","keywordSearchUrl":"https://example.com/search?q={keyword}"}]',
      help_custom_repos:
        'Supports id/name/icon/domainSearchUrl/keywordSearchUrl/domainSearchEnabled/keywordSearchEnabled',
      label_enable_shortcut: 'Enable shortcut (Alt+Shift+F)',
      label_debug_enabled: 'Enable debug logs',
      btn_export_file: 'Export to file',
      btn_export_clipboard: 'Export to clipboard',
      btn_import_text: 'Import from text',
      btn_import_file: 'Import from file',
      btn_reset_global: 'Reset global settings',
      btn_reset_site: 'Reset current site settings',
      aria_close: 'Close',
      text_report_issue: 'Report an Issue…',
      text_brand: 'Made with \u2764\uFE0F by Pipecraft',
      msg_export_prompt: 'Copy the JSON below',
      msg_import_prompt: 'Paste JSON to import settings',
      msg_import_success: 'Settings imported successfully',
      msg_import_failed: 'Import failed: invalid JSON',
      msg_export_clipboard_success: 'Settings copied to clipboard',
      msg_export_clipboard_failed: 'Clipboard export failed',
      msg_import_file_failed: 'Import failed: unable to read file',
      msg_reset_global_confirm:
        'Reset global settings? This operation cannot be undone.',
      msg_reset_site_confirm:
        'Reset current site settings? This operation cannot be undone.',
      msg_reset_done: 'Settings reset completed',
      btn_add_entry: 'Add entry',
      btn_move_up: 'Up',
      btn_move_down: 'Down',
      btn_remove: 'Remove',
      btn_reset_quick_entries: 'Restore default quick entries',
      menu_more_search: 'More search…',
      menu_settings_short: 'Settings',
      text_mode_domain_short: 'Domain',
      text_mode_keyword_short: 'Keyword',
      entry_aggregate_domain: 'All repos · Domain',
      entry_aggregate_keyword: 'All repos · Keyword',
      preset_recommended: 'Recommended',
      preset_common: 'Common',
      preset_full: 'Full',
      preset_custom: 'Custom',
      tab_menu: 'Menu',
      tab_search: 'Search',
      tab_repos: 'Repositories',
      title_quick_entries: 'Quick Menu Entries',
      label_quick_entries: 'Displayed entries',
      help_quick_entries:
        'Only these entries are shown directly in the Tampermonkey menu.',
      title_search_global: 'Keyword Source (Global)',
      title_search_site: 'Keyword Source (Current Site Override)',
      title_repos_global: 'Repositories (Global)',
      title_repos_site: 'Repositories (Current Site Override)',
      title_behavior: 'Behavior',
      help_repo_matrix_global:
        'Enable which repositories participate in domain and keyword search.',
      help_repo_matrix_site:
        'Only override repositories that should differ on the current site.',
      menu_settings: '\u2699\uFE0F Settings',
    },
    'zh-CN': {
      menu_domain:
        '{icon} \u5728 {name} \u4E0A\u6309\u57DF\u540D\u67E5\u627E\u811A\u672C',
      menu_keyword:
        '{icon} \u5728 {name} \u4E0A\u6309\u5173\u952E\u5B57\u67E5\u627E\u811A\u672C',
      menu_aggregate_domain:
        '\u{1F517} \u5728\u6240\u6709\u5DF2\u542F\u7528\u4ED3\u5E93\u6309\u57DF\u540D\u641C\u7D22 ({count})',
      menu_aggregate_keyword:
        '\u{1F517} \u5728\u6240\u6709\u5DF2\u542F\u7528\u4ED3\u5E93\u6309\u5173\u952E\u8BCD\u641C\u7D22 ({count})',
      title_settings: '\u4ED3\u5E93\u8BBE\u7F6E',
      btn_save: '\u4FDD\u5B58',
      btn_cancel: '\u53D6\u6D88',
      title_domain: '\u57DF\u540D\u641C\u7D22',
      title_keyword: '\u5173\u952E\u5B57\u641C\u7D22',
      title_domain_global: '\u57DF\u540D\u641C\u7D22(\u5168\u5C40)',
      title_keyword_global: '\u5173\u952E\u8BCD\u641C\u7D22(\u5168\u5C40)',
      title_domain_site: '\u57DF\u540D\u641C\u7D22(\u5F53\u524D\u7AD9\u70B9)',
      title_keyword_site: '\u5173\u952E\u8BCD\u641C\u7D22(\u5F53\u524D\u7AD9\u70B9)',
      title_aggregate: '\u805A\u5408\u641C\u7D22',
      title_custom_repos: '\u81EA\u5B9A\u4E49\u4ED3\u5E93',
      title_data: '\u6570\u636E\u7BA1\u7406',
      title_scope_actions: '\u4F5C\u7528\u57DF\u64CD\u4F5C',
      tab_global: '\u5168\u5C40',
      tab_site: '\u7AD9\u70B9',
      tab_advanced: '\u9AD8\u7EA7',
      label_keyword_source: '\u5173\u952E\u8BCD\u6765\u6E90',
      label_keyword_manual: '\u624B\u52A8\u5173\u952E\u8BCD',
      placeholder_keyword_manual:
        '\u8F93\u5165\u624B\u52A8\u6A21\u5F0F\u5173\u952E\u8BCD',
      help_keyword_manual:
        '\u4EC5\u5728\u300C\u624B\u52A8\u6587\u672C\u300D\u6A21\u5F0F\u751F\u6548',
      keyword_source_domain: '\u4F7F\u7528\u57DF\u540D',
      keyword_source_hostname: '\u4F7F\u7528\u4E3B\u673A\u540D',
      keyword_source_title: '\u4F7F\u7528\u9875\u9762\u6807\u9898',
      keyword_source_selection: '\u4F7F\u7528\u9009\u4E2D\u6587\u672C',
      keyword_source_manual: '\u4F7F\u7528\u624B\u52A8\u6587\u672C',
      label_aggregate_domain: '\u542F\u7528\u805A\u5408\u57DF\u540D\u83DC\u5355',
      label_aggregate_keyword: '\u542F\u7528\u805A\u5408\u5173\u952E\u8BCD\u83DC\u5355',
      label_aggregate_background:
        '\u805A\u5408\u641C\u7D22\u6807\u7B7E\u9875\u5728\u540E\u53F0\u6253\u5F00',
      label_aggregate_delay: '\u805A\u5408\u6253\u5F00\u95F4\u9694(\u6BEB\u79D2)',
      help_aggregate_delay:
        '\u6BCF\u4E2A\u6807\u7B7E\u9875\u7684\u6253\u5F00\u95F4\u9694\uff0C\u8303\u56F4 0-2000 \u6BEB\u79D2',
      label_custom_repos: '\u81EA\u5B9A\u4E49\u4ED3\u5E93(JSON \u6570\u7EC4)',
      placeholder_custom_repos:
        '[{"id":"my_repo","name":"\u6211\u7684\u4ED3\u5E93","icon":"\u{1F680}","domainSearchUrl":"https://example.com/search?d={domain}","keywordSearchUrl":"https://example.com/search?q={keyword}"}]',
      help_custom_repos:
        '\u652F\u6301 id/name/icon/domainSearchUrl/keywordSearchUrl/domainSearchEnabled/keywordSearchEnabled',
      label_enable_shortcut:
        '\u542F\u7528\u5FEB\u6377\u952E(Alt+Shift+F)',
      label_debug_enabled: '\u542F\u7528\u8C03\u8BD5\u65E5\u5FD7',
      btn_export_file: '\u5BFC\u51FA\u4E3A\u6587\u4EF6',
      btn_export_clipboard: '\u5BFC\u51FA\u5230\u526A\u5207\u677F',
      btn_import_text: '\u7C98\u8D34\u6587\u672C\u5BFC\u5165',
      btn_import_file: '\u4ECE\u6587\u4EF6\u5BFC\u5165',
      btn_reset_global: '\u91CD\u7F6E\u5168\u5C40\u8BBE\u7F6E',
      btn_reset_site: '\u91CD\u7F6E\u5F53\u524D\u7AD9\u70B9\u8BBE\u7F6E',
      aria_close: '\u5173\u95ED',
      text_report_issue: '\u53CD\u9988\u95EE\u9898\u2026',
      text_brand: '\u7531 Pipecraft \u7528\u5FC3\u5236\u4F5C',
      msg_export_prompt: '\u590D\u5236\u4E0B\u65B9 JSON',
      msg_import_prompt: '\u7C98\u8D34 JSON \u4EE5\u5BFC\u5165\u8BBE\u7F6E',
      msg_import_success: '\u5BFC\u5165\u8BBE\u7F6E\u6210\u529F',
      msg_import_failed: '\u5BFC\u5165\u5931\u8D25\uff1AJSON \u65E0\u6548',
      msg_export_clipboard_success: '\u8BBE\u7F6E\u5DF2\u590D\u5236\u5230\u526A\u5207\u677F',
      msg_export_clipboard_failed: '\u5BFC\u51FA\u5230\u526A\u5207\u677F\u5931\u8D25',
      msg_import_file_failed: '\u5BFC\u5165\u5931\u8D25\uff1A\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6',
      msg_reset_global_confirm:
        '\u786E\u5B9A\u91CD\u7F6E\u5168\u5C40\u8BBE\u7F6E\u5417\uff1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002',
      msg_reset_site_confirm:
        '\u786E\u5B9A\u91CD\u7F6E\u5F53\u524D\u7AD9\u70B9\u8BBE\u7F6E\u5417\uff1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002',
      msg_reset_done: '\u91CD\u7F6E\u5B8C\u6210',
      btn_add_entry: '\u6DFB\u52A0\u5165\u53E3',
      btn_move_up: '\u4E0A\u79FB',
      btn_move_down: '\u4E0B\u79FB',
      btn_remove: '\u79FB\u9664',
      btn_reset_quick_entries: '\u6062\u590D\u9ED8\u8BA4\u76F4\u8FBE\u5165\u53E3',
      menu_more_search: '\u66F4\u591A\u641C\u7D22\u2026',
      menu_settings_short: '\u8BBE\u7F6E',
      text_mode_domain_short: '\u57DF\u540D',
      text_mode_keyword_short: '\u5173\u952E\u8BCD',
      entry_aggregate_domain:
        '\u6240\u6709\u4ED3\u5E93 \u00B7 \u57DF\u540D',
      entry_aggregate_keyword:
        '\u6240\u6709\u4ED3\u5E93 \u00B7 \u5173\u952E\u8BCD',
      preset_recommended: '\u6781\u7B80\u63A8\u8350',
      preset_common: '\u5E38\u7528\u4ED3\u5E93',
      preset_full: '\u5168\u91CF\u517C\u5BB9',
      preset_custom: '\u81EA\u5B9A\u4E49',
      tab_menu: '\u83DC\u5355',
      tab_search: '\u641C\u7D22',
      tab_repos: '\u4ED3\u5E93',
      title_quick_entries: '\u76F4\u8FBE\u5165\u53E3',
      label_quick_entries: '\u5F53\u524D\u663E\u793A',
      help_quick_entries:
        '\u53EA\u6709\u8FD9\u4E9B\u5165\u53E3\u4F1A\u76F4\u63A5\u663E\u793A\u5728 Tampermonkey \u83DC\u5355\u91CC',
      title_search_global: '\u5173\u952E\u8BCD\u6765\u6E90(\u5168\u5C40)',
      title_search_site:
        '\u5173\u952E\u8BCD\u6765\u6E90(\u5F53\u524D\u7AD9\u70B9\u8986\u76D6)',
      title_repos_global: '\u4ED3\u5E93\u5F00\u5173(\u5168\u5C40)',
      title_repos_site:
        '\u4ED3\u5E93\u5F00\u5173(\u5F53\u524D\u7AD9\u70B9\u8986\u76D6)',
      title_behavior: '\u884C\u4E3A',
      help_repo_matrix_global:
        '\u63A7\u5236\u54EA\u4E9B\u4ED3\u5E93\u53C2\u4E0E\u57DF\u540D\u641C\u7D22\u4E0E\u5173\u952E\u8BCD\u641C\u7D22',
      help_repo_matrix_site:
        '\u4EC5\u5728\u5F53\u524D\u7AD9\u70B9\u9700\u8981\u4E0D\u540C\u65F6\u624D\u8986\u76D6\u5168\u5C40\u8BBE\u7F6E',
      menu_settings: '\u2699\uFE0F \u8BBE\u7F6E',
    },
    'zh-TW': {
      menu_domain:
        '{icon} \u5728 {name} \u4E0A\u6309\u57DF\u540D\u67E5\u627E\u8173\u672C',
      menu_keyword:
        '{icon} \u5728 {name} \u4E0A\u6309\u95DC\u9375\u5B57\u67E5\u627E\u8173\u672C',
      menu_aggregate_domain:
        '\u{1F517} \u5728\u6240\u6709\u5DF2\u555F\u7528\u5009\u5EAB\u4EE5\u7DB2\u57DF\u641C\u5C0B ({count})',
      menu_aggregate_keyword:
        '\u{1F517} \u5728\u6240\u6709\u5DF2\u555F\u7528\u5009\u5EAB\u4EE5\u95DC\u9375\u5B57\u641C\u5C0B ({count})',
      title_settings: '\u5009\u5EAB\u8A2D\u7F6E',
      btn_save: '\u4FDD\u5B58',
      btn_cancel: '\u53D6\u6D88',
      title_domain: '\u57DF\u540D\u641C\u7D22',
      title_keyword: '\u95DC\u9375\u5B57\u641C\u7D22',
      title_domain_global: '\u7DB2\u57DF\u641C\u5C0B(\u5168\u57DF)',
      title_keyword_global: '\u95DC\u9375\u5B57\u641C\u5C0B(\u5168\u57DF)',
      title_domain_site: '\u7DB2\u57DF\u641C\u5C0B(\u7576\u524D\u7DB2\u7AD9)',
      title_keyword_site: '\u95DC\u9375\u5B57\u641C\u5C0B(\u7576\u524D\u7DB2\u7AD9)',
      title_aggregate: '\u805A\u5408\u641C\u5C0B',
      title_custom_repos: '\u81EA\u8A02\u5009\u5EAB',
      title_data: '\u8CC7\u6599\u7BA1\u7406',
      title_scope_actions: '\u7BC4\u570D\u64CD\u4F5C',
      tab_global: '\u5168\u57DF',
      tab_site: '\u7DB2\u7AD9',
      tab_advanced: '\u9032\u968E',
      label_keyword_source: '\u95DC\u9375\u5B57\u4F86\u6E90',
      label_keyword_manual: '\u624B\u52D5\u95DC\u9375\u5B57',
      placeholder_keyword_manual:
        '\u8F38\u5165\u624B\u52D5\u6A21\u5F0F\u95DC\u9375\u5B57',
      help_keyword_manual:
        '\u50C5\u5728\u300C\u624B\u52D5\u6587\u5B57\u300D\u6A21\u5F0F\u751F\u6548',
      keyword_source_domain: '\u4F7F\u7528\u7DB2\u57DF',
      keyword_source_hostname: '\u4F7F\u7528\u4E3B\u6A5F\u540D\u7A31',
      keyword_source_title: '\u4F7F\u7528\u9801\u9762\u6A19\u984C',
      keyword_source_selection: '\u4F7F\u7528\u9078\u53D6\u6587\u5B57',
      keyword_source_manual: '\u4F7F\u7528\u624B\u52D5\u6587\u5B57',
      label_aggregate_domain: '\u555F\u7528\u805A\u5408\u7DB2\u57DF\u9078\u55AE',
      label_aggregate_keyword: '\u555F\u7528\u805A\u5408\u95DC\u9375\u5B57\u9078\u55AE',
      label_aggregate_background:
        '\u805A\u5408\u641C\u5C0B\u6A19\u7C64\u9801\u5728\u80CC\u666F\u958B\u555F',
      label_aggregate_delay: '\u805A\u5408\u958B\u555F\u9593\u9694(\u6BEB\u79D2)',
      help_aggregate_delay:
        '\u6BCF\u500B\u6A19\u7C64\u9801\u7684\u958B\u555F\u9593\u9694\uff0c\u7BC4\u570D 0-2000 \u6BEB\u79D2',
      label_custom_repos: '\u81EA\u8A02\u5009\u5EAB(JSON \u9663\u5217)',
      placeholder_custom_repos:
        '[{"id":"my_repo","name":"\u6211\u7684\u5009\u5EAB","icon":"\u{1F680}","domainSearchUrl":"https://example.com/search?d={domain}","keywordSearchUrl":"https://example.com/search?q={keyword}"}]',
      help_custom_repos:
        '\u652F\u63F4 id/name/icon/domainSearchUrl/keywordSearchUrl/domainSearchEnabled/keywordSearchEnabled',
      label_enable_shortcut:
        '\u555F\u7528\u5FEB\u901F\u9375(Alt+Shift+F)',
      label_debug_enabled: '\u555F\u7528\u9664\u932F\u65E5\u8A8C',
      btn_export_file: '\u532F\u51FA\u70BA\u6A94\u6848',
      btn_export_clipboard: '\u532F\u51FA\u5230\u526A\u8CBC\u7C3F',
      btn_import_text: '\u8CBC\u4E0A\u6587\u5B57\u532F\u5165',
      btn_import_file: '\u5F9E\u6A94\u6848\u532F\u5165',
      btn_reset_global: '\u91CD\u8A2D\u5168\u57DF\u8A2D\u5B9A',
      btn_reset_site: '\u91CD\u8A2D\u7576\u524D\u7DB2\u7AD9\u8A2D\u5B9A',
      aria_close: '\u95DC\u9589',
      text_report_issue: '\u56DE\u5831\u554F\u984C\u2026',
      text_brand: '\u7531 Pipecraft \u7528\u5FC3\u88FD\u4F5C',
      msg_export_prompt: '\u8907\u88FD\u4E0B\u65B9 JSON',
      msg_import_prompt: '\u8CBC\u4E0A JSON \u4EE5\u532F\u5165\u8A2D\u5B9A',
      msg_import_success: '\u532F\u5165\u8A2D\u5B9A\u6210\u529F',
      msg_import_failed: '\u532F\u5165\u5931\u6557\uff1AJSON \u7121\u6548',
      msg_export_clipboard_success: '\u8A2D\u5B9A\u5DF2\u8907\u88FD\u5230\u526A\u8CBC\u7C3F',
      msg_export_clipboard_failed: '\u532F\u51FA\u5230\u526A\u8CBC\u7C3F\u5931\u6557',
      msg_import_file_failed: '\u532F\u5165\u5931\u6557\uff1A\u7121\u6CD5\u8B80\u53D6\u6A94\u6848',
      msg_reset_global_confirm:
        '\u78BA\u5B9A\u91CD\u8A2D\u5168\u57DF\u8A2D\u5B9A\u55CE\uff1F\u6B64\u64CD\u4F5C\u7121\u6CD5\u5FA9\u539F\u3002',
      msg_reset_site_confirm:
        '\u78BA\u5B9A\u91CD\u8A2D\u7576\u524D\u7DB2\u7AD9\u8A2D\u5B9A\u55CE\uff1F\u6B64\u64CD\u4F5C\u7121\u6CD5\u5FA9\u539F\u3002',
      msg_reset_done: '\u91CD\u8A2D\u5B8C\u6210',
      btn_add_entry: '\u65B0\u589E\u5165\u53E3',
      btn_move_up: '\u4E0A\u79FB',
      btn_move_down: '\u4E0B\u79FB',
      btn_remove: '\u79FB\u9664',
      btn_reset_quick_entries: '\u9084\u539F\u9810\u8A2D\u76F4\u9054\u5165\u53E3',
      menu_more_search: '\u66F4\u591A\u641C\u5C0B\u2026',
      menu_settings_short: '\u8A2D\u7F6E',
      text_mode_domain_short: '\u7DB2\u57DF',
      text_mode_keyword_short: '\u95DC\u9375\u5B57',
      entry_aggregate_domain:
        '\u6240\u6709\u5009\u5EAB \u00B7 \u7DB2\u57DF',
      entry_aggregate_keyword:
        '\u6240\u6709\u5009\u5EAB \u00B7 \u95DC\u9375\u5B57',
      preset_recommended: '\u6975\u7C21\u63A8\u85A6',
      preset_common: '\u5E38\u7528\u5009\u5EAB',
      preset_full: '\u5168\u91CF\u76F8\u5BB9',
      preset_custom: '\u81EA\u8A02',
      tab_menu: '\u9078\u55AE',
      tab_search: '\u641C\u5C0B',
      tab_repos: '\u5009\u5EAB',
      title_quick_entries: '\u76F4\u9054\u5165\u53E3',
      label_quick_entries: '\u76EE\u524D\u986F\u793A',
      help_quick_entries:
        '\u53EA\u6709\u9019\u4E9B\u5165\u53E3\u6703\u76F4\u63A5\u51FA\u73FE\u5728 Tampermonkey \u9078\u55AE',
      title_search_global: '\u95DC\u9375\u5B57\u4F86\u6E90(\u5168\u57DF)',
      title_search_site:
        '\u95DC\u9375\u5B57\u4F86\u6E90(\u7576\u524D\u7DB2\u7AD9\u8986\u84CB)',
      title_repos_global: '\u5009\u5EAB\u958B\u95DC(\u5168\u57DF)',
      title_repos_site:
        '\u5009\u5EAB\u958B\u95DC(\u7576\u524D\u7DB2\u7AD9\u8986\u84CB)',
      title_behavior: '\u884C\u70BA',
      help_repo_matrix_global:
        '\u63A7\u5236\u54EA\u4E9B\u5009\u5EAB\u53C3\u8207\u7DB2\u57DF\u641C\u5C0B\u8207\u95DC\u9375\u5B57\u641C\u5C0B',
      help_repo_matrix_site:
        '\u50C5\u5728\u7576\u524D\u7DB2\u7AD9\u9700\u8981\u4E0D\u540C\u6642\u624D\u8986\u84CB\u5168\u57DF\u8A2D\u5B9A',
      menu_settings: '\u2699\uFE0F \u8A2D\u7F6E',
    },
    ja: {
      menu_domain:
        '{icon} {name} \u3067\u30C9\u30E1\u30A4\u30F3\u304B\u3089\u30B9\u30AF\u30EA\u30D7\u30C8\u3092\u63A2\u3059',
      menu_keyword:
        '{icon} {name} \u3067\u30AD\u30FC\u30EF\u30FC\u30C9\u304B\u3089\u30B9\u30AF\u30EA\u30D7\u30C8\u3092\u63A2\u3059',
      title_settings: '\u30EA\u30DD\u30B8\u30C8\u30EA\u8A2D\u5B9A',
      btn_save: '\u4FDD\u5B58',
      btn_cancel: '\u30AD\u30E3\u30F3\u30BB\u30EB',
      title_domain: '\u30C9\u30E1\u30A4\u30F3\u691C\u7D22',
      title_keyword: '\u30AD\u30FC\u30EF\u30FC\u30C9\u691C\u7D22',
      menu_settings: '\u2699\uFE0F \u8A2D\u5B9A',
    },
    ko: {
      menu_domain:
        '{icon} {name}\uC5D0\uC11C \uB3C4\uBA54\uC778\uC73C\uB85C \uC2A4\uD06C\uB9BD\uD2B8 \uCC3E\uAE30',
      menu_keyword:
        '{icon} {name}\uC5D0\uC11C \uD0A4\uC6CC\uB4DC\uB85C \uC2A4\uD06C\uB9BD\uD2B8 \uCC3E\uAE30',
      title_settings: '\uC800\uC7A5\uC18C \uC124\uC815',
      btn_save: '\uC800\uC7A5',
      btn_cancel: '\uCDE8\uC18C',
      title_domain: '\uB3C4\uBA54\uC778 \uAC80\uC0C9',
      title_keyword: '\uD0A4\uC6CC\uB4DC \uAC80\uC0C9',
      menu_settings: '\u2699\uFE0F \uC124\uC815',
    },
    es: {
      menu_domain: '{icon} Buscar scripts por dominio en {name}',
      menu_keyword: '{icon} Buscar scripts por palabra clave en {name}',
      title_settings: 'Configuraci\xF3n de repositorios',
      btn_save: 'Guardar',
      btn_cancel: 'Cancelar',
      title_domain: 'B\xFAsqueda por dominio',
      title_keyword: 'B\xFAsqueda por palabra clave',
      menu_settings: '\u2699\uFE0F Configuraci\xF3n',
    },
    fr: {
      menu_domain: '{icon} Trouver des scripts par domaine sur {name}',
      menu_keyword: '{icon} Trouver des scripts par mot-cl\xE9 sur {name}',
      title_settings: 'Param\xE8tres des d\xE9p\xF4ts',
      btn_save: 'Enregistrer',
      btn_cancel: 'Annuler',
      title_domain: 'Recherche par domaine',
      title_keyword: 'Recherche par mot-cl\xE9',
      menu_settings: '\u2699\uFE0F Param\xE8tres',
    },
    de: {
      menu_domain: '{icon} Skripte nach Domain auf {name} finden',
      menu_keyword: '{icon} Skripte nach Stichwort auf {name} finden',
      title_settings: 'Repository-Einstellungen',
      btn_save: 'Speichern',
      btn_cancel: 'Abbrechen',
      title_domain: 'Domain-Suche',
      title_keyword: 'Stichwortsuche',
      menu_settings: '\u2699\uFE0F Einstellungen',
    },
    ru: {
      menu_domain:
        '{icon} \u041D\u0430\u0439\u0442\u0438 \u0441\u043A\u0440\u0438\u043F\u0442\u044B \u043F\u043E \u0434\u043E\u043C\u0435\u043D\u0443 \u043D\u0430 {name}',
      menu_keyword:
        '{icon} \u041D\u0430\u0439\u0442\u0438 \u0441\u043A\u0440\u0438\u043F\u0442\u044B \u043F\u043E \u043A\u043B\u044E\u0447\u0435\u0432\u043E\u043C\u0443 \u0441\u043B\u043E\u0432\u0443 \u043D\u0430 {name}',
      title_settings:
        '\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0440\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0440\u0438\u0435\u0432',
      btn_save: '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C',
      btn_cancel: '\u041E\u0442\u043C\u0435\u043D\u0430',
      title_domain:
        '\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0434\u043E\u043C\u0435\u043D\u0443',
      title_keyword:
        '\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u043A\u043B\u044E\u0447\u0435\u0432\u043E\u043C\u0443 \u0441\u043B\u043E\u0432\u0443',
      menu_settings:
        '\u2699\uFE0F \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438',
    },
  }
  var USER_LANG = detectLanguage()
  var LANG_MAP =
    USER_LANG === 'en'
      ? I18N.en
      : __spreadValues(__spreadValues({}, I18N.en), I18N[USER_LANG])
  function t(key) {
    return LANG_MAP[key]
  }
  function detectLanguage() {
    try {
      const browserLang = (
        navigator.language ||
        navigator.userLanguage ||
        'en'
      ).toLowerCase()
      const supportedLangs = Object.keys(I18N)
      if (supportedLangs.includes(browserLang)) {
        return browserLang
      }
      const langBase = browserLang.split('-')[0]
      const matchingLang = supportedLangs.find((lang) =>
        lang.startsWith(langBase + '-')
      )
      if (matchingLang) {
        return matchingLang
      }
      return 'en'
    } catch (error) {
      debugLog('Error detecting language:', error)
      return 'en'
    }
  }
  function debugLog(message, data = null) {
    if (CONFIG.DEBUG) {
      console.log('[Find Scripts] '.concat(message), data || '')
    }
  }
  function getDomainScriptCount(repoId, domain) {
    if (!domain) return 0
    if (repoId === 'greasy_fork') {
      return getScriptCount(domain, gfData)
    }
    if (repoId === 'sleazy_fork') {
      return getScriptCount(domain, sfData)
    }
    return 0
  }
  function getCompactRepoMenuText(repo, mode, count = 0) {
    const suffix =
      mode === 'domain'
        ? t('text_mode_domain_short') || 'Domain'
        : t('text_mode_keyword_short') || 'Keyword'
    let text = ''.concat(repo.icon, ' ').concat(repo.name, ' · ').concat(suffix)
    if (mode === 'domain' && count > 0) {
      text += ' ('.concat(count, ')')
    }
    return text
  }
  function getCompactAggregateMenuText(mode, count) {
    const label =
      mode === 'domain'
        ? t('entry_aggregate_domain') || 'All repos · Domain'
        : t('entry_aggregate_keyword') || 'All repos · Keyword'
    return '🔗 '.concat(label, ' (').concat(count || 0, ')')
  }
  function openUrlsInBatch(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return
    const delay = normalizeAggregateDelay(CURRENT_SETTINGS.aggregate_open_delay_ms)
    const background = normalizeBoolean(
      CURRENT_SETTINGS.aggregate_open_background,
      false
    )
    urls.forEach((url, index) => {
      const openOnce = () =>
        openInTab(url, {
          active: background ? false : index === 0,
          insert: true,
        })
      if (delay <= 0) {
        openOnce()
      } else {
        globalThis.setTimeout(openOnce, delay * index)
      }
    })
  }
  function openAggregateSearch(isKeywordSearch) {
    const runtimeContext = resolveSearchContext()
    const keyword = isKeywordSearch
      ? resolveKeyword(CURRENT_SETTINGS, runtimeContext)
      : ''
    const value = isKeywordSearch ? keyword : runtimeContext.searchDomain
    const mode = isKeywordSearch ? 'keyword' : 'domain'
    const token = isKeywordSearch ? '{keyword}' : '{domain}'
    const urls = []
    for (const repo of CURRENT_REPOSITORIES) {
      const enabled = resolveRepoSearchEnabled(repo, mode, CURRENT_SETTINGS)
      const template = isKeywordSearch ? repo.keywordSearchUrl : repo.domainSearchUrl
      if (!template || !enabled) continue
      urls.push(buildSearchUrl(template, token, value))
    }
    debugLog(
      'Opening aggregate search',
      { mode, count: urls.length, value }
    )
    openUrlsInBatch(urls)
  }
  function openRepositorySearch(repo, mode) {
    if (!repo) return
    const runtimeContext = resolveSearchContext()
    const value =
      mode === 'domain'
        ? runtimeContext.searchDomain
        : resolveKeyword(CURRENT_SETTINGS, runtimeContext)
    const template = mode === 'domain' ? repo.domainSearchUrl : repo.keywordSearchUrl
    if (!template) return
    const token = mode === 'domain' ? '{domain}' : '{keyword}'
    const targetUrl = buildSearchUrl(template, token, value)
    debugLog(
      'Opening repository search',
      { repo: repo.name, mode, value }
    )
    openInTab(targetUrl, { active: true, insert: true })
  }
  function getEnabledRepositories(mode) {
    const repositories = []
    for (const repo of CURRENT_REPOSITORIES) {
      const enabled = resolveRepoSearchEnabled(repo, mode, CURRENT_SETTINGS)
      const template = mode === 'domain' ? repo.domainSearchUrl : repo.keywordSearchUrl
      if (!enabled || !template) continue
      repositories.push(repo)
    }
    return repositories
  }
  function buildQuickMenuItem(entryId, context) {
    const parsed = parseQuickEntryId(entryId)
    if (parsed.type === 'repo') {
      const repo = findRepositoryById(parsed.repoId, CURRENT_REPOSITORIES)
      if (!repo) return null
      if (!resolveRepoSearchEnabled(repo, parsed.mode, CURRENT_SETTINGS)) return null
      const count =
        parsed.mode === 'domain'
          ? getDomainScriptCount(repo.id, context.countDomain)
          : 0
      return {
        id: entryId,
        text: getCompactRepoMenuText(repo, parsed.mode, count),
        onClick: () => openRepositorySearch(repo, parsed.mode),
      }
    }
    if (parsed.type === 'aggregate') {
      const enabledRepos = getEnabledRepositories(parsed.mode)
      const aggregateEnabled =
        parsed.mode === 'domain'
          ? normalizeBoolean(CURRENT_SETTINGS.aggregate_domain_enabled, true)
          : normalizeBoolean(CURRENT_SETTINGS.aggregate_keyword_enabled, true)
      if (!aggregateEnabled || enabledRepos.length <= 1) return null
      return {
        id: entryId,
        text: getCompactAggregateMenuText(parsed.mode, enabledRepos.length),
        onClick: () => openAggregateSearch(parsed.mode === 'keyword'),
      }
    }
    if (parsed.type === 'panel' && parsed.panel === 'more') {
      return {
        id: entryId,
        text: '📚 '.concat(t('menu_more_search') || 'More search…'),
        onClick: () => showMoreSearchPanel(),
      }
    }
    return null
  }
  var MENU_IDS = []
  var SETTINGS_MENU_ID
  var LAST_MENU_SIGNATURE = ''
  var MENU_REFRESH_DEBOUNCE_MS = 120
  var menuRefreshTimer
  var lastLocationHref = ''
  var locationListenersReady = false
  function clearMenus() {
    for (const id of MENU_IDS) {
      unregisterMenu(id)
    }
    MENU_IDS = []
    if (SETTINGS_MENU_ID) {
      unregisterMenu(SETTINGS_MENU_ID)
      SETTINGS_MENU_ID = void 0
    }
    LAST_MENU_SIGNATURE = ''
  }
  function registerAllMenus() {
    const context = resolveSearchContext()
    const quickEntries = normalizeQuickMenuEntries(
      CURRENT_SETTINGS.quick_menu_entries,
      CURRENT_REPOSITORIES
    )
    const items = []
    for (const entryId of quickEntries) {
      const item = buildQuickMenuItem(entryId, context)
      if (item) items.push(item)
    }
    const signature = JSON.stringify(
      items.map((item) => ({ id: item.id, text: item.text }))
    )
    if (signature === LAST_MENU_SIGNATURE && MENU_IDS.length === items.length && SETTINGS_MENU_ID) {
      return
    }
    clearMenus()
    for (const item of items) {
      MENU_IDS.push(registerMenu(item.text, item.onClick))
    }
    registerSettingsMenu()
    LAST_MENU_SIGNATURE = signature
  }
  var CURRENT_SETTINGS = {}
  function buildDefaults(repositories = CONFIG.REPOSITORIES) {
    var _a, _b
    const out = {}
    for (const repo of repositories) {
      if (repo.domainSearchUrl)
        out['domain_'.concat(repo.id)] =
          (_a = repo.domainSearchEnabled) != null ? _a : false
      if (repo.keywordSearchUrl)
        out['keyword_'.concat(repo.id)] =
          (_b = repo.keywordSearchEnabled) != null ? _b : false
    }
    out.settings_version = SETTINGS_VERSION
    out.menu_preset_id = 'recommended'
    out.quick_menu_entries = buildPresetQuickEntries('recommended', repositories)
    out.keyword_source_mode = 'domain'
    out.keyword_manual_text = ''
    out.aggregate_domain_enabled = true
    out.aggregate_keyword_enabled = true
    out.aggregate_open_background = false
    out.aggregate_open_delay_ms = 120
    out.custom_repositories_json = ''
    out.enable_shortcut = true
    out.debug_enabled = false
    return out
  }
  var SETTINGS_STORE = createSettingsStore('', buildDefaults(), true)
  SETTINGS_STORE.onBeforeSet((values) => normalizeSettingsPatch(values))
  async function refreshMenus() {
    await loadSettings()
    clearMenus()
    registerAllMenus()
  }
  function scheduleMenusRefresh() {
    if (menuRefreshTimer !== void 0) {
      globalThis.clearTimeout(menuRefreshTimer)
    }
    menuRefreshTimer = globalThis.setTimeout(() => {
      void refreshMenus()
    }, MENU_REFRESH_DEBOUNCE_MS)
  }
  function onLocationMaybeChanged() {
    const href = String(win.location.href || '')
    if (!href || href === lastLocationHref) return
    lastLocationHref = href
    scheduleMenusRefresh()
  }
  function setupLocationChangeListeners() {
    if (locationListenersReady) return
    locationListenersReady = true
    lastLocationHref = String(win.location.href || '')
    const handler = () => onLocationMaybeChanged()
    try {
      win.addEventListener('popstate', handler, true)
      win.addEventListener('hashchange', handler, true)
    } catch (e) {}
    try {
      const history = win.history
      const wrappedFlag = '__fsiHistoryWrapped'
      if (history && !history[wrappedFlag]) {
        history[wrappedFlag] = true
        const wrap = (methodName) => {
          const original = history[methodName]
          if (typeof original !== 'function') return
          history[methodName] = function (...args) {
            const result = original.apply(this, args)
            handler()
            return result
          }
        }
        wrap('pushState')
        wrap('replaceState')
      }
    } catch (e) {}
  }
  async function loadSettings() {
    try {
      const all = await SETTINGS_STORE.getAll()
      const baseSettings = normalizeSettingsObject(all, CONFIG.REPOSITORIES)
      const repositories = rebuildRepositories(baseSettings)
      const normalized = normalizeSettingsObject(baseSettings, repositories)
      CURRENT_SETTINGS = applyRepositorySettingDefaults(normalized, repositories)
      CONFIG.DEBUG = normalizeBoolean(CURRENT_SETTINGS.debug_enabled, false)
      debugLog('Settings loaded:', CURRENT_SETTINGS)
    } catch (error) {
      debugLog('Error loading settings:', error)
    }
  }
  function listenSettings() {
    try {
      SETTINGS_STORE.onChange(() => {
        scheduleMenusRefresh()
      })
    } catch (e) {}
  }
  function showPrompt(message, defaultValue = '') {
    try {
      return globalThis.prompt(message, defaultValue)
    } catch (e) {
      return null
    }
  }
  function showAlert(message) {
    try {
      globalThis.alert(message)
    } catch (e) {}
  }
  function showConfirm(message) {
    try {
      return Boolean(globalThis.confirm(message))
    } catch (e) {
      return false
    }
  }
  async function buildSettingsExportPayload() {
    const globalSettings = await SETTINGS_STORE.getAll(true)
    const siteSettings = await SETTINGS_STORE.getAll(false)
    return {
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      settings: {
        global: globalSettings,
        site: siteSettings,
      },
    }
  }
  function createExportFileName() {
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    return 'find-scripts-settings-'
      .concat(now.getFullYear())
      .concat(pad(now.getMonth() + 1))
      .concat(pad(now.getDate()))
      .concat('-')
      .concat(pad(now.getHours()))
      .concat(pad(now.getMinutes()))
      .concat(pad(now.getSeconds()))
      .concat('.json')
  }
  function downloadTextAsFile(filename, text) {
    try {
      const blob = new Blob([text], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = c('a', {
        attrs: { href: url, download: filename },
      })
      link.style.display = 'none'
      doc.documentElement.append(link)
      link.click()
      link.remove()
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 1e3)
      return true
    } catch (e) {
      return false
    }
  }
  async function copyTextToClipboard(text) {
    try {
      if (
        navigator &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch (e) {}
    try {
      const ta = c('textarea', { value: text })
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      ta.style.top = '0'
      doc.body.append(ta)
      ta.focus()
      ta.select()
      const ok = doc.execCommand('copy')
      ta.remove()
      return Boolean(ok)
    } catch (e) {
      return false
    }
  }
  function pickTextFile() {
    return new Promise((resolve) => {
      try {
        const input = c('input', {
          type: 'file',
          attrs: { accept: '.json,application/json,text/plain' },
        })
        input.style.display = 'none'
        const cleanup = () => {
          try {
            input.remove()
          } catch (e) {}
        }
        input.addEventListener(
          'change',
          () => {
            const file = input.files && input.files[0]
            if (!file) {
              cleanup()
              resolve(null)
              return
            }
            const reader = new FileReader()
            reader.onload = () => {
              cleanup()
              resolve(String(reader.result || ''))
            }
            reader.onerror = () => {
              cleanup()
              resolve(null)
            }
            reader.readAsText(file, 'utf-8')
          },
          { once: true }
        )
        doc.documentElement.append(input)
        input.click()
      } catch (e) {
        resolve(null)
      }
    })
  }
  async function applyImportedSettingsPayload(payload) {
    if (!payload) return false
    if (isObject(payload.global) || isObject(payload.site)) {
      if (isObject(payload.global)) {
        await SETTINGS_STORE.set(payload.global, true)
      }
      if (isObject(payload.site)) {
        await SETTINGS_STORE.set(payload.site, false)
      }
    } else {
      await SETTINGS_STORE.set(payload, true)
    }
    scheduleMenusRefresh()
    return true
  }
  function parseImportedSettingsPayload(rawText) {
    if (!rawText) return null
    let parsed
    try {
      parsed = JSON.parse(rawText)
    } catch (e) {
      return null
    }
    if (isObject(parsed) && isObject(parsed.settings)) {
      parsed = parsed.settings
    }
    if (!isObject(parsed)) return null
    return parsed
  }
  async function handleSettingsAction(actionId) {
    if (actionId === 'export_settings_file' || actionId === 'export_settings') {
      const payload = await buildSettingsExportPayload()
      const text = JSON.stringify(payload, null, 2)
      const ok = downloadTextAsFile(createExportFileName(), text)
      if (!ok) {
        showPrompt(t('msg_export_prompt') || 'Copy the JSON below', text)
      }
      return
    }
    if (actionId === 'export_settings_clipboard') {
      const payload = await buildSettingsExportPayload()
      const ok = await copyTextToClipboard(JSON.stringify(payload, null, 2))
      showAlert(
        ok
          ? t('msg_export_clipboard_success') || 'Settings copied to clipboard'
          : t('msg_export_clipboard_failed') || 'Clipboard export failed'
      )
      return
    }
    if (actionId === 'import_settings_text' || actionId === 'import_settings') {
      const input = showPrompt(
        t('msg_import_prompt') || 'Paste JSON to import settings',
        ''
      )
      if (input === null) return
      const payload = parseImportedSettingsPayload(input)
      if (!payload) {
        showAlert(t('msg_import_failed') || 'Import failed: invalid JSON')
        return
      }
      await applyImportedSettingsPayload(payload)
      showAlert(t('msg_import_success') || 'Settings imported successfully')
      return
    }
    if (actionId === 'import_settings_file') {
      const rawText = await pickTextFile()
      if (rawText === null) return
      const payload = parseImportedSettingsPayload(rawText)
      if (!payload) {
        showAlert(t('msg_import_failed') || 'Import failed: invalid JSON')
        return
      }
      try {
        await applyImportedSettingsPayload(payload)
      } catch (e) {
        showAlert(
          t('msg_import_file_failed') || 'Import failed: unable to read file'
        )
        return
      }
      showAlert(t('msg_import_success') || 'Settings imported successfully')
      return
    }
    if (actionId === 'reset_global') {
      const ok = showConfirm(
        t('msg_reset_global_confirm') ||
          'Reset global settings? This operation cannot be undone.'
      )
      if (!ok) return
      await SETTINGS_STORE.reset(true)
      scheduleMenusRefresh()
      showAlert(t('msg_reset_done') || 'Settings reset completed')
      return
    }
    if (actionId === 'reset_site') {
      const ok = showConfirm(
        t('msg_reset_site_confirm') ||
          'Reset current site settings? This operation cannot be undone.'
      )
      if (!ok) return
      await SETTINGS_STORE.reset(false)
      scheduleMenusRefresh()
      showAlert(t('msg_reset_done') || 'Settings reset completed')
    }
  }
  var SETTINGS_PANEL_STYLE =
    '.user-settings .row.row-wide{align-items:flex-start}.user-settings .row.row-wide .value-wrap{align-items:stretch;min-width:260px;width:100%}.user-settings .row.row-custom-block{display:block;padding-inline:0}.user-settings .row.row-custom-block>*{max-width:100%;width:100%}.user-settings .custom-stack{display:flex;flex-direction:column;gap:8px;max-width:100%;min-width:0;width:100%}.user-settings .quick-entry-list{display:flex;flex-direction:column;gap:8px;width:100%}.user-settings .quick-entry-item{align-items:center;background:rgba(15,23,42,.04);border:1px solid rgba(148,163,184,.35);border-radius:12px;display:flex;gap:10px;justify-content:space-between;padding:10px 12px}.user-settings .quick-entry-title{color:var(--color-gray-800);font-weight:600;text-align:left}.user-settings .quick-entry-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}.user-settings .mini-btn{border:1px solid rgba(148,163,184,.45);border-radius:8px;color:var(--color-gray-700);cursor:pointer;padding:4px 10px}.user-settings .mini-btn:hover{background:rgba(148,163,184,.12)}.user-settings .mini-btn.danger{border-color:rgba(239,68,68,.45);color:#dc2626}.user-settings .quick-add-row{display:flex;gap:8px;width:100%}.user-settings .quick-add-row select{flex:1;min-width:0;text-align:left;width:auto}.user-settings .repo-matrix{display:flex;flex-direction:column;gap:10px;width:100%}.user-settings .repo-item{align-items:center;background:rgba(15,23,42,.04);border:1px solid rgba(148,163,184,.3);border-radius:12px;display:flex;gap:12px;justify-content:space-between;padding:10px 12px}.user-settings .repo-meta{display:flex;flex-direction:column;gap:2px;text-align:left}.user-settings .repo-name{color:var(--color-gray-800);font-weight:600}.user-settings .repo-id{color:var(--color-gray-500);font-size:11px}.user-settings .repo-switches{display:flex;flex-wrap:wrap;gap:12px;justify-content:flex-end}.user-settings .repo-switch{align-items:center;display:flex;gap:8px}.user-settings .repo-switch span{color:var(--color-gray-600);font-size:12px}.user-settings .panel-link-note{color:var(--color-gray-500);font-size:11px;line-height:1.5;max-width:100%;overflow-wrap:anywhere;text-align:left;white-space:normal;word-break:break-word}.user-settings .custom-repo-editor{background:rgba(15,23,42,.03);border:1px solid rgba(148,163,184,.28);border-radius:12px;box-sizing:border-box;max-width:100%;min-width:0;overflow:hidden;padding:12px;width:100%}.user-settings .custom-repo-editor textarea.repo-textarea{box-sizing:border-box;font-family:var(--font-mono);font-size:12px;line-height:1.6;max-width:100%;min-height:220px;min-width:0;overflow-wrap:anywhere;text-align:left;white-space:pre-wrap;width:100%;word-break:break-word}.user-settings .action-stack .seg{justify-content:flex-start}'
  function buildKeywordConfigFields(isSitePref) {
    return [
      {
        type: 'radio',
        key: 'keyword_source_mode',
        label: t('label_keyword_source'),
        isSitePref,
        options: [
          { value: 'domain', label: t('keyword_source_domain') },
          { value: 'hostname', label: t('keyword_source_hostname') },
          { value: 'title', label: t('keyword_source_title') },
          { value: 'selection', label: t('keyword_source_selection') },
          { value: 'manual', label: t('keyword_source_manual') },
        ],
      },
      {
        type: 'input',
        key: 'keyword_manual_text',
        label: t('label_keyword_manual'),
        placeholder: t('placeholder_keyword_manual'),
        help: t('help_keyword_manual'),
        isSitePref,
      },
    ]
  }
  function buildQuickMenuBuilderField() {
    return {
      type: 'custom',
      key: 'quick_menu_entries',
      render: ({ createFieldRow, getFieldValue }) => {
        const stack = c('div', { className: 'custom-stack quick-menu-builder' })
        const list = c('div', { className: 'quick-entry-list' })
        const addRow = c('div', { className: 'quick-add-row' })
        const select = c('select', { className: 'quick-entry-select' })
        const addBtn = c('button', {
          className: 'btn action-btn',
          dataset: { key: 'quick_menu_entries', action: 'quick_entry_add' },
          text: t('btn_add_entry') || 'Add entry',
        })
        const resetBtn = c('button', {
          className: 'btn action-btn btn-danger',
          dataset: { key: 'quick_menu_entries', action: 'quick_entries_reset_default' },
          text: t('btn_reset_quick_entries') || 'Restore default quick entries',
        })
        const note = c('div', {
          className: 'panel-link-note',
          text: t('help_quick_entries') || '',
        })
        addRow.append(select)
        addRow.append(addBtn)
        stack.append(list)
        stack.append(addRow)
        stack.append(resetBtn)
        stack.append(note)
        const row = createFieldRow(
          {
            key: 'quick_menu_entries',
            label: t('label_quick_entries') || 'Quick entries',
          },
          stack
        )
        row.classList.add('row-wide')
        const fill = () => {
          const currentEntries = normalizeQuickMenuEntries(
            getFieldValue('quick_menu_entries', row),
            CURRENT_REPOSITORIES
          )
          list.replaceChildren()
          if (currentEntries.length === 0) {
            list.append(
              c('div', {
                className: 'panel-link-note',
                text: t('help_quick_entries') || '',
              })
            )
          }
          currentEntries.forEach((entryId, index) => {
            const item = c('div', { className: 'quick-entry-item' })
            const title = c('div', {
              className: 'quick-entry-title',
              text: getQuickEntryDisplayLabel(entryId, CURRENT_REPOSITORIES),
            })
            const actions = c('div', { className: 'quick-entry-actions' })
            const moveUp = c('button', {
              className: 'mini-btn action-btn',
              dataset: {
                key: 'quick_menu_entries',
                action: 'quick_entry_move_up',
                entryId,
              },
              text: t('btn_move_up') || 'Up',
            })
            const moveDown = c('button', {
              className: 'mini-btn action-btn',
              dataset: {
                key: 'quick_menu_entries',
                action: 'quick_entry_move_down',
                entryId,
              },
              text: t('btn_move_down') || 'Down',
            })
            const removeBtn = c('button', {
              className: 'mini-btn danger action-btn',
              dataset: {
                key: 'quick_menu_entries',
                action: 'quick_entry_remove',
                entryId,
              },
              text: t('btn_remove') || 'Remove',
            })
            if (index === 0) moveUp.disabled = true
            if (index === currentEntries.length - 1) moveDown.disabled = true
            actions.append(moveUp)
            actions.append(moveDown)
            actions.append(removeBtn)
            item.append(title)
            item.append(actions)
            list.append(item)
          })
          const used = new Set(currentEntries)
          select.replaceChildren()
          for (const entry of buildQuickEntryDefinitions(CURRENT_REPOSITORIES)) {
            if (used.has(entry.id)) continue
            select.append(
              c('option', {
                value: entry.id,
                text: getQuickEntryDisplayLabel(entry.id, CURRENT_REPOSITORIES),
              })
            )
          }
          addBtn.disabled = select.options.length === 0
        }
        return {
          row,
          fillers: [{ key: '*', fn: fill }],
        }
      },
    }
  }
  function buildRepositoryMatrixField(isSitePref) {
    return {
      type: 'custom',
      key: isSitePref ? 'repo_matrix_site' : 'repo_matrix_global',
      render: ({ createFieldRow, getFieldValue }) => {
        const box = c('div', { className: 'repo-matrix' })
        const row = createFieldRow(
          {
            key: isSitePref ? 'repo_matrix_site' : 'repo_matrix_global',
            label: t('tab_repos') || 'Repositories',
            help: isSitePref
              ? t('help_repo_matrix_site')
              : t('help_repo_matrix_global'),
          },
          box
        )
        row.classList.add('row-wide')
        const fill = () => {
          box.replaceChildren()
          for (const repo of CURRENT_REPOSITORIES) {
            const item = c('div', { className: 'repo-item' })
            const meta = c('div', { className: 'repo-meta' })
            meta.append(
              c('div', {
                className: 'repo-name',
                text: ''.concat(repo.icon, ' ').concat(repo.name),
              })
            )
            meta.append(
              c('div', { className: 'repo-id', text: repo.id })
            )
            const switches = c('div', { className: 'repo-switches' })
            const appendSwitch = (mode) => {
              const key = ''.concat(mode, '_').concat(repo.id)
              const checkbox = c('input', {
                type: 'checkbox',
                className: 'toggle-checkbox',
                dataset: { key, isSitePref: isSitePref ? '1' : '' },
              })
              checkbox.checked = Boolean(getFieldValue(key, checkbox))
              const label = c('label', { className: 'repo-switch' })
              label.append(
                c('span', {
                  text:
                    mode === 'domain'
                      ? t('text_mode_domain_short') || 'Domain'
                      : t('text_mode_keyword_short') || 'Keyword',
                })
              )
              label.append(checkbox)
              switches.append(label)
            }
            if (repo.domainSearchUrl) appendSwitch('domain')
            if (repo.keywordSearchUrl) appendSwitch('keyword')
            item.append(meta)
            item.append(switches)
            box.append(item)
          }
        }
        return {
          row,
          fillers: [{ key: '*', fn: fill }],
        }
      },
    }
  }
  function buildCustomRepositoriesField() {
    return {
      type: 'custom',
      key: 'custom_repositories_json',
      render: ({ getFieldValue }) => {
        const row = c('div', { className: 'row row-wide row-custom-block' })
        const stack = c('div', {
          className: 'custom-stack custom-repo-editor',
        })
        const title = c('div', {
          className: 'quick-entry-title',
          text: t('label_custom_repos'),
        })
        const help = c('div', {
          className: 'panel-link-note',
          text: t('help_custom_repos') || '',
        })
        const textarea = c('textarea', {
          className: 'repo-textarea',
          rows: 10,
          placeholder: t('placeholder_custom_repos') || '',
          dataset: { key: 'custom_repositories_json' },
          attrs: { wrap: 'soft', spellcheck: 'false' },
        })
        stack.append(title)
        stack.append(help)
        stack.append(textarea)
        row.append(stack)
        return {
          row,
          fillers: [
            {
              key: 'custom_repositories_json',
              fn: () => {
                textarea.value = String(
                  getFieldValue('custom_repositories_json', textarea) || ''
                )
              },
            },
          ],
        }
      },
    }
  }
  async function mutateQuickMenuEntries(mutator) {
    const currentEntries = normalizeQuickMenuEntries(
      await SETTINGS_STORE.get('quick_menu_entries', true),
      CURRENT_REPOSITORIES
    )
    const nextEntries = normalizeQuickMenuEntries(
      mutator(currentEntries.slice()) || currentEntries,
      CURRENT_REPOSITORIES
    )
    await SETTINGS_STORE.set(
      {
        quick_menu_entries: nextEntries,
        menu_preset_id: 'custom',
      },
      true
    )
  }
  async function handleQuickMenuAction(actionId, target) {
    if (!target) return false
    if (actionId === 'quick_entries_reset_default') {
      await SETTINGS_STORE.set(
        {
          menu_preset_id: 'recommended',
          quick_menu_entries: buildPresetQuickEntries(
            'recommended',
            CURRENT_REPOSITORIES
          ),
        },
        true
      )
      return true
    }
    if (actionId === 'quick_entry_add') {
      const wrap = target.closest('.quick-menu-builder')
      const select = wrap == null ? void 0 : wrap.querySelector('.quick-entry-select')
      if (!(select instanceof HTMLSelectElement) || !select.value) return true
      await mutateQuickMenuEntries((entries) => {
        if (!entries.includes(select.value)) entries.push(select.value)
        return entries
      })
      return true
    }
    const entryId = target.dataset.entryId || ''
    if (!entryId) return false
    if (actionId === 'quick_entry_remove') {
      await mutateQuickMenuEntries((entries) =>
        entries.filter((item) => item !== entryId)
      )
      return true
    }
    if (actionId === 'quick_entry_move_up') {
      await mutateQuickMenuEntries((entries) => {
        const index = entries.indexOf(entryId)
        if (index > 0) {
          const temp = entries[index - 1]
          entries[index - 1] = entries[index]
          entries[index] = temp
        }
        return entries
      })
      return true
    }
    if (actionId === 'quick_entry_move_down') {
      await mutateQuickMenuEntries((entries) => {
        const index = entries.indexOf(entryId)
        if (index !== -1 && index < entries.length - 1) {
          const temp = entries[index + 1]
          entries[index + 1] = entries[index]
          entries[index] = temp
        }
        return entries
      })
      return true
    }
    return false
  }
  async function handleMoreSearchAction(actionId) {
    if (!actionId) return
    if (actionId === 'aggregate_domain') {
      openAggregateSearch(false)
      return
    }
    if (actionId === 'aggregate_keyword') {
      openAggregateSearch(true)
      return
    }
    if (actionId === 'open_settings') {
      showSettingsDialog()
      return
    }
    if (actionId.startsWith('repo_search::')) {
      const parts = actionId.split('::')
      if (parts.length !== 3) return
      const repo = findRepositoryById(parts[2], CURRENT_REPOSITORIES)
      if (!repo) return
      openRepositorySearch(repo, parts[1])
    }
  }
  function showMoreSearchPanel() {
    closeSettingsPanel()
    const context = resolveSearchContext()
    const domainRepos = getEnabledRepositories('domain')
    const keywordRepos = getEnabledRepositories('keyword')
    const batchActions = []
    if (
      domainRepos.length > 1 &&
      normalizeBoolean(CURRENT_SETTINGS.aggregate_domain_enabled, true)
    ) {
      batchActions.push({
        id: 'aggregate_domain',
        text: getCompactAggregateMenuText('domain', domainRepos.length),
      })
    }
    if (
      keywordRepos.length > 1 &&
      normalizeBoolean(CURRENT_SETTINGS.aggregate_keyword_enabled, true)
    ) {
      batchActions.push({
        id: 'aggregate_keyword',
        text: getCompactAggregateMenuText('keyword', keywordRepos.length),
      })
    }
    const groups = []
    if (domainRepos.length > 0) {
      groups.push({
        id: 'more-domain',
        title: t('title_domain'),
        fields: [
          {
            type: 'action',
            key: 'more_domain_actions',
            layout: 'vertical',
            actions: domainRepos.map((repo) => ({
              id: 'repo_search::domain::'.concat(repo.id),
              text: getCompactRepoMenuText(
                repo,
                'domain',
                getDomainScriptCount(repo.id, context.countDomain)
              ),
            })),
          },
        ],
      })
    }
    if (keywordRepos.length > 0) {
      groups.push({
        id: 'more-keyword',
        title: t('title_keyword'),
        fields: [
          {
            type: 'action',
            key: 'more_keyword_actions',
            layout: 'vertical',
            actions: keywordRepos.map((repo) => ({
              id: 'repo_search::keyword::'.concat(repo.id),
              text: getCompactRepoMenuText(repo, 'keyword'),
            })),
          },
        ],
      })
    }
    if (batchActions.length > 0) {
      groups.push({
        id: 'more-batch',
        title: t('title_aggregate'),
        fields: [
          {
            type: 'action',
            key: 'more_batch_actions',
            layout: 'vertical',
            actions: batchActions,
          },
        ],
      })
    }
    groups.push({
      id: 'more-tools',
      title: t('title_scope_actions') || 'Actions',
      fields: [
        {
          type: 'action',
          key: 'more_tools_actions',
          actions: [{ id: 'open_settings', text: '⚙️ '.concat(t('menu_settings_short') || 'Settings') }],
        },
      ],
    })
    openSettingsPanel(
      {
        type: 'simple',
        title: t('menu_more_search') || 'More search…',
        groups,
      },
      SETTINGS_STORE,
      {
        hostDatasetKey: 'fsftsHost',
        hostDatasetValue: 'find-scripts-more',
        onAction: ({ actionId }) => {
          void handleMoreSearchAction(actionId)
        },
        styleText: SETTINGS_PANEL_STYLE,
        theme: {
          activeBg: '#0f766e',
          activeFg: '#ffffff',
          colorRing: '#0f766e',
          toggleOnBg: '#059669',
        },
      }
    )
  }
  async function handleSettingsPanelAction(actionId, target) {
    if (await handleQuickMenuAction(actionId, target)) return
    await handleSettingsAction(actionId)
  }
  function showSettingsDialog() {
    closeSettingsPanel()
    const advancedBehaviorFields = [
      {
        type: 'toggle',
        key: 'aggregate_domain_enabled',
        label: t('label_aggregate_domain'),
      },
      {
        type: 'toggle',
        key: 'aggregate_keyword_enabled',
        label: t('label_aggregate_keyword'),
      },
      {
        type: 'toggle',
        key: 'aggregate_open_background',
        label: t('label_aggregate_background'),
      },
      {
        type: 'input',
        key: 'aggregate_open_delay_ms',
        label: t('label_aggregate_delay'),
        help: t('help_aggregate_delay'),
      },
      {
        type: 'toggle',
        key: 'enable_shortcut',
        label: t('label_enable_shortcut'),
      },
      {
        type: 'toggle',
        key: 'debug_enabled',
        label: t('label_debug_enabled'),
      },
    ]
    const advancedCustomFields = [buildCustomRepositoriesField()]
    const dataActionFields = [
      {
        type: 'action',
        key: 'export_actions',
        layout: 'vertical',
        actions: [
          { id: 'export_settings_file', text: t('btn_export_file') || 'Export to file' },
          {
            id: 'export_settings_clipboard',
            text: t('btn_export_clipboard') || 'Export to clipboard',
          },
        ],
      },
      {
        type: 'action',
        key: 'import_actions',
        layout: 'vertical',
        actions: [
          { id: 'import_settings_text', text: t('btn_import_text') || 'Import from text' },
          { id: 'import_settings_file', text: t('btn_import_file') || 'Import from file' },
        ],
      },
      {
        type: 'action',
        key: 'reset_actions',
        layout: 'vertical',
        actions: [
          { id: 'reset_global', text: t('btn_reset_global'), kind: 'danger' },
          { id: 'reset_site', text: t('btn_reset_site'), kind: 'danger' },
        ],
      },
    ]
    const schema = {
      type: 'tabs',
      title: t('title_settings'),
      tabs: [
        {
          id: 'menu',
          title: t('tab_menu') || 'Menu',
          groups: [
            {
              id: 'menu-quick',
              title: t('title_quick_entries'),
              fields: [buildQuickMenuBuilderField()],
            },
          ],
        },
        {
          id: 'search',
          title: t('tab_search') || 'Search',
          groups: [
            {
              id: 'search-global',
              title: t('title_search_global') || t('title_keyword_global'),
              fields: buildKeywordConfigFields(false),
            },
            {
              id: 'search-site',
              title: t('title_search_site') || t('title_keyword_site'),
              fields: buildKeywordConfigFields(true),
            },
          ],
        },
        {
          id: 'repos',
          title: t('tab_repos') || 'Repositories',
          groups: [
            {
              id: 'repos-global',
              title: t('title_repos_global') || t('title_domain_global'),
              fields: [buildRepositoryMatrixField(false)],
            },
            {
              id: 'repos-site',
              title: t('title_repos_site') || t('title_domain_site'),
              fields: [buildRepositoryMatrixField(true)],
            },
          ],
        },
        {
          id: 'advanced',
          title: t('tab_advanced'),
          groups: [
            {
              id: 'advanced-behavior',
              title: t('title_behavior') || t('title_aggregate'),
              fields: advancedBehaviorFields,
            },
            {
              id: 'advanced-custom',
              title: t('title_custom_repos'),
              fields: advancedCustomFields,
            },
            {
              id: 'advanced-data',
              title: t('title_data'),
              fields: dataActionFields,
            },
          ],
        },
      ],
    }
    openSettingsPanel(schema, SETTINGS_STORE, {
      hostDatasetKey: 'fsftsHost',
      hostDatasetValue: 'find-scripts-settings',
      onAction: ({ actionId, target }) => {
        void handleSettingsPanelAction(actionId, target)
      },
      styleText: SETTINGS_PANEL_STYLE,
      theme: {
        activeBg: '#0f766e',
        activeFg: '#ffffff',
        colorRing: '#0f766e',
        toggleOnBg: '#059669',
      },
    })
  }
  function registerSettingsMenu() {
    const menuText = '⚙️ '.concat(t('menu_settings_short') || 'Settings')
    SETTINGS_MENU_ID = registerMenu(menuText, showSettingsDialog)
  }
  var shortcutListenerReady = false
  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false
    const tag = (target.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
    return target.isContentEditable
  }
  function setupShortcutListener() {
    if (shortcutListenerReady) return
    shortcutListenerReady = true
    try {
      globalThis.addEventListener(
        'keydown',
        (e) => {
          if (!normalizeBoolean(CURRENT_SETTINGS.enable_shortcut, true)) return
          if (isEditableTarget(e.target)) return
          if (e.altKey && e.shiftKey && e.code === 'KeyF') {
            e.preventDefault()
            showSettingsDialog()
          }
        },
        true
      )
    } catch (e) {}
  }
  async function initialize() {
    await refreshMenus()
    listenSettings()
    setupLocationChangeListeners()
    setupShortcutListener()
  }
  void initialize()
})()
