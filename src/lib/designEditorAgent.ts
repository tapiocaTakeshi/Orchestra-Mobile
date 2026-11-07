/**
 * 見た目の編集 (DesignVisualEditor) でプレビューに差し込むスクリプト。
 * 触った要素 (data-od-id の付いた一番内側) を選んで枠で示し、その id と計算済みのスタイルを親 (アプリ) に送る。
 * リンク・ボタン・フォームは動かさない (選ぶだけ)。読み直し後も、選んでいた要素とスクロール位置を戻す。
 *
 * 親へは iOS / Android は window.ReactNativeWebView.postMessage (文字列)、Web 版は parent.postMessage。
 * 中身は { __od: true, type: 'select' | 'scroll' | 'ready', ... }。
 */

import { ID_ATTR } from './htmlPatch';

/** 計算済みのスタイルとして送るもの */
export const DESIGN_COMPUTED_PROPS = [
	'color', 'background-color', 'font-size', 'font-weight', 'text-align', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'margin-top', 'margin-bottom', 'border-radius', 'width', 'height', 'display',
] as const;

export type DesignComputedStyle = Partial<Record<(typeof DESIGN_COMPUTED_PROPS)[number], string>>;

export type DesignAgentMessage =
	| { type: 'ready' }
	| { type: 'select'; id: number | null; computed?: DesignComputedStyle }
	| { type: 'scroll'; y: number };

/** プレビューから届いたものを読む (関係ないメッセージや壊れたものは null) */
export const parseDesignAgentMessage = (raw: unknown): DesignAgentMessage | null => {
	let data = raw;
	if (typeof data === 'string') {
		try { data = JSON.parse(data); } catch { return null; }
	}
	if (!data || typeof data !== 'object' || (data as { __od?: unknown }).__od !== true) return null;
	const m = data as Record<string, unknown>;
	if (m.type === 'ready') return { type: 'ready' };
	if (m.type === 'scroll' && typeof m.y === 'number' && Number.isFinite(m.y)) return { type: 'scroll', y: m.y };
	if (m.type === 'select') {
		const id = typeof m.id === 'number' && Number.isInteger(m.id) && m.id >= 0 ? m.id : null;
		const computed: DesignComputedStyle = {};
		if (m.computed && typeof m.computed === 'object') {
			for (const p of DESIGN_COMPUTED_PROPS) {
				const v = (m.computed as Record<string, unknown>)[p];
				if (typeof v === 'string') computed[p] = v;
			}
		}
		return { type: 'select', id, computed };
	}
	return null;
};

/** <head> の直後 (無ければ先頭) に差し込む <script>。selected / scrollY は読み直す前の状態 */
export const designAgentScript = (state: { selected: number | null; scrollY: number }): string => {
	const js = `(function(){
var ATTR=${JSON.stringify(ID_ATTR)};var PROPS=${JSON.stringify(DESIGN_COMPUTED_PROPS)};
var state=${JSON.stringify({ selected: state.selected, scrollY: Math.max(0, Math.round(state.scrollY)) })};
function send(m){m.__od=true;try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m));}else{parent.postMessage(m,'*');}}catch(e){}}
var box=null;function ensureBox(){if(box&&box.isConnected)return box;box=document.createElement('od-selection');box.setAttribute('style','position:absolute!important;pointer-events:none!important;z-index:2147483647!important;outline:2px solid #D43E45!important;background:rgba(212,62,69,.08)!important;display:none;margin:0!important;padding:0!important;border:0!important;');document.documentElement.appendChild(box);return box;}
var selected=null;
function place(){var b=ensureBox();if(!selected||!selected.isConnected){b.style.display='none';return;}var r=selected.getBoundingClientRect();b.style.left=(r.left+window.scrollX)+'px';b.style.top=(r.top+window.scrollY)+'px';b.style.width=r.width+'px';b.style.height=r.height+'px';b.style.display='block';}
function computed(el){var cs=getComputedStyle(el);var o={};for(var i=0;i<PROPS.length;i++){o[PROPS[i]]=cs.getPropertyValue(PROPS[i]);}return o;}
function select(el,notify){selected=el;place();if(notify){send(el?{type:'select',id:Number(el.getAttribute(ATTR)),computed:computed(el)}:{type:'select',id:null});}}
function target(e){var t=e.target;var el=t&&t.nodeType===1?t:(t&&t.parentElement);return el&&el.closest?el.closest('['+ATTR+']'):null;}
document.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var el=target(e);if(el&&(el.tagName==='HTML'||el.tagName==='BODY'))el=null;select(el,true);},true);
document.addEventListener('submit',function(e){e.preventDefault();},true);
var t=null;window.addEventListener('scroll',function(){place();if(t)clearTimeout(t);t=setTimeout(function(){send({type:'scroll',y:window.scrollY});},120);},{passive:true});
window.addEventListener('resize',place);
function start(){if(state.scrollY)window.scrollTo(0,state.scrollY);if(state.selected!==null){var el=document.querySelector('['+ATTR+'="'+state.selected+'"]');select(el,true);}send({type:'ready'});setTimeout(place,300);}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',start);}else{start();}
})();`;
	return `<script data-od-agent>${js.replace(/<\/script/gi, '<\\/script')}</script>`;
};

/** HTML の <head> の直後 (無ければ <html> の直後、どちらも無ければ先頭) に差し込む */
export const injectIntoHead = (html: string, snippet: string): string => {
	const head = /<head\b[^>]*>/i.exec(html);
	if (head) return html.slice(0, head.index + head[0].length) + snippet + html.slice(head.index + head[0].length);
	const root = /<html\b[^>]*>/i.exec(html);
	if (root) return html.slice(0, root.index + root[0].length) + snippet + html.slice(root.index + root[0].length);
	return snippet + html;
};
