// パネルのスタイル（Shadow DOM 内で使うので YouTube 側の CSS とは干渉しない）
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});
  YTS.PANEL_CSS = `
:host {
  all: initial;
  --bg: #ffffff;
  --bg2: #f2f2f2;
  --bg3: #e5e5e5;
  --fg: #0f0f0f;
  --fg2: #606060;
  --line: rgba(0, 0, 0, 0.1);
  --accent: #ff0033;
  --accent-soft: rgba(255, 0, 51, 0.09);
  --accent-text: #cc0029;
  --blue: #065fd4;
  --blue-soft: rgba(6, 95, 212, 0.09);
  --shadow: -8px 0 32px rgba(0, 0, 0, 0.16);
  font-family: "Roboto", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--fg);
}
:host([dark]) {
  --bg: #212121;
  --bg2: #303030;
  --bg3: #3f3f3f;
  --fg: #f1f1f1;
  --fg2: #aaaaaa;
  --line: rgba(255, 255, 255, 0.12);
  --accent-soft: rgba(255, 78, 106, 0.16);
  --accent-text: #ff6b81;
  --blue: #3ea6ff;
  --blue-soft: rgba(62, 166, 255, 0.14);
  --shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; cursor: pointer; }
a { color: inherit; text-decoration: none; }
svg { flex: none; }

.fab {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 52px; height: 52px; border-radius: 50%; border: none;
  background: var(--accent); color: #fff;
  display: grid; place-items: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  opacity: 0.9; transition: transform 0.15s, opacity 0.15s;
}
.fab:hover { opacity: 1; transform: scale(1.06) rotate(-10deg); }
.fab[hidden] { display: none; }

.panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483001;
  width: min(720px, 100vw);
  background: var(--bg); color: var(--fg);
  border-left: 1px solid var(--line); box-shadow: var(--shadow);
  display: flex; flex-direction: column;
  transform: translateX(105%); visibility: hidden;
  transition: transform 0.22s ease, visibility 0s linear 0.22s;
}
.panel.open { transform: none; visibility: visible; transition: transform 0.22s ease; }
.panel.resizing { transition: none; user-select: none; }
.resizer {
  position: absolute; left: -5px; top: 0; bottom: 0; width: 10px; z-index: 1;
  cursor: ew-resize; touch-action: none;
}
.resizer::after {
  content: ""; position: absolute; left: 3px; top: 50%; width: 4px; height: 48px; margin-top: -24px;
  border-radius: 2px; background: var(--bg3); opacity: 0; transition: opacity 0.15s;
}
.resizer:hover::after, .panel.resizing .resizer::after { opacity: 1; }

.hd { display: flex; align-items: center; gap: 4px; padding: 12px 10px 8px 16px; }
.brand { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; }
.brand svg { color: var(--accent); }
.spacer { flex: 1; }
.icon-btn {
  width: 36px; height: 36px; border-radius: 50%; border: none; background: transparent;
  display: grid; place-items: center; color: var(--fg);
}
.icon-btn:hover { background: var(--bg2); }

.tabs { display: flex; gap: 8px; padding: 0 16px; }
.tab {
  flex: 1; height: 36px; padding: 0 12px; border-radius: 8px; border: none;
  background: var(--bg2); font-weight: 500;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.tab:hover { background: var(--bg3); }
.tab[aria-selected="true"] { background: var(--fg); color: var(--bg); }
.desc { margin: 10px 16px 0; color: var(--fg2); font-size: 12.5px; }

.actions { display: flex; gap: 8px; padding: 12px 16px 4px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 14px; border-radius: 18px; border: none;
  background: var(--bg2); font-weight: 500; white-space: nowrap;
}
.btn:hover { background: var(--bg3); }
.btn.primary { flex: 1; background: var(--accent); color: #fff; }
.btn.primary:hover { filter: brightness(1.08); }
.btn.ghost { background: transparent; border: 1px solid var(--line); }
.btn.ghost:hover { background: var(--bg2); }
.btn:disabled { opacity: 0.5; cursor: default; filter: none; }

.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 16px 0; }
.flabel { font-size: 12.5px; font-weight: 500; color: var(--fg2); margin-right: 2px; }
.sel, .num {
  height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--bg2); color: var(--fg); font: inherit; font-size: 13px;
}
.sel:hover, .num:hover { background: var(--bg3); }
.num { width: 64px; }
.custom { display: inline-flex; align-items: center; gap: 6px; }
.custom[hidden] { display: none; }
.suffix { font-size: 13px; color: var(--fg2); }
.status { padding: 6px 16px 0; font-size: 12px; color: var(--fg2); }
.progress { padding: 8px 16px 0; display: none; }
.progress.on { display: block; }
.bar { height: 4px; border-radius: 2px; background: var(--bg2); overflow: hidden; }
.bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width 0.2s; }
.bar.indet i { width: 30%; animation: indet 1.1s ease-in-out infinite; }
@keyframes indet { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
.ptext { display: block; margin-top: 4px; font-size: 12px; color: var(--fg2); }

.error {
  display: none; margin: 10px 16px 0; padding: 10px 12px; border-radius: 8px;
  background: var(--accent-soft); border: 1px solid var(--accent-soft); font-size: 13px;
}
.error.on { display: block; }

.info { padding: 10px 16px 2px; font-size: 12px; color: var(--fg2); }
.terms { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; align-items: center; }
.term { padding: 1px 8px; border-radius: 10px; background: var(--bg2); font-size: 11px; color: var(--fg); }

.found { padding: 8px 16px 0; }
.found h4 { margin: 0 0 6px; font-size: 12px; font-weight: 500; color: var(--fg2); }
.found .row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; }
.chan { flex: none; padding: 5px 10px; border-radius: 16px; background: var(--blue-soft); color: var(--blue); font-size: 12px; white-space: nowrap; }
.chan:hover { filter: brightness(1.1); text-decoration: underline; }

.list { flex: 1; overflow-y: auto; padding: 4px 8px 12px; scrollbar-width: thin; container-type: inline-size; }
.grid { display: grid; grid-template-columns: 1fr; gap: 2px; }
.card {
  position: relative; display: grid; grid-template-columns: 168px 1fr; gap: 10px;
  padding: 8px; border-radius: 10px;
}
.card:hover { background: var(--bg2); }
.card.seen { opacity: 0.45; }
.thumb {
  position: relative; display: block; width: 168px; aspect-ratio: 16 / 9;
  border-radius: 8px; overflow: hidden; background: var(--bg3);
}
.thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.dur {
  position: absolute; right: 4px; bottom: 4px; padding: 1px 4px; border-radius: 4px;
  background: rgba(0, 0, 0, 0.8); color: #fff; font-size: 12px; font-weight: 500;
}
.body { min-width: 0; }
.title {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-right: 26px; font-size: 14px; font-weight: 500; line-height: 1.35;
}
.meta { margin-top: 3px; font-size: 12px; color: var(--fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta a:hover { color: var(--fg); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.chip { padding: 1px 7px; border-radius: 10px; background: var(--bg2); color: var(--fg2); font-size: 11px; }
.card:hover .chip { background: var(--bg); }
.chip.reason { background: var(--accent-soft); color: var(--accent-text); }
.chip.similar { background: var(--blue-soft); color: var(--blue); }
.acts {
  position: absolute; top: 6px; right: 4px; display: flex; flex-direction: column; gap: 4px;
  opacity: 0; transition: opacity 0.15s;
}
.card:hover .acts, .card:focus-within .acts { opacity: 1; }
.acts button {
  width: 26px; height: 26px; border-radius: 50%; border: none; background: var(--bg);
  display: grid; place-items: center; color: var(--fg2); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.acts button:hover { color: var(--accent); }

.empty { padding: 48px 28px; text-align: center; color: var(--fg2); }
.empty svg { color: var(--accent); }
.empty p { margin: 12px 0 0; }
.empty b { color: var(--fg); }

.diag {
  display: none; margin: 0 16px 8px; max-height: 200px; overflow: auto; padding: 8px 10px;
  border-radius: 8px; background: var(--bg2); white-space: pre-wrap;
  font: 11.5px/1.5 ui-monospace, Menlo, Consolas, monospace;
}
.diag.on { display: block; }
.ft {
  display: flex; align-items: center; gap: 12px; padding: 8px 16px;
  border-top: 1px solid var(--line); font-size: 12px; color: var(--fg2);
}
.link {
  padding: 0; border: none; background: none; color: var(--fg2); font-size: 12px;
  text-decoration: underline; text-underline-offset: 2px;
}
.link:hover { color: var(--fg); }

/* 幅が広いときはサムネイルを上に置いたグリッド表示 */
@container (min-width: 600px) {
  .grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 4px; }
  .card { grid-template-columns: 1fr; gap: 8px; align-content: start; }
  .thumb { width: 100%; }
  .title { margin-right: 0; font-size: 15px; }
  .acts { top: 14px; right: 14px; flex-direction: row; }
}
@container (max-width: 400px) {
  .card { grid-template-columns: 128px 1fr; }
  .thumb { width: 128px; }
}
`;
})(globalThis);
