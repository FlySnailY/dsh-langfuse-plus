window.__ModuleLoader__.load({ id: "dsh-langfuse-plus", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var LANGFUSE_URL = "http://localhost:3000/project/dsh-prod/traces";
var inject = ["slots"];
function apply(ctx) {
  return ctx.slots.register(
    {
      name: "sidebar.footer.action",
      id: "langfuse",
      order: 100
    },
    LangfuseFooterAction
  );
}
function LangfuseFooterAction(props) {
  const [hovered, setHovered] = (0, import_react.useState)(false);
  const openLangfuse = () => {
    window.open(LANGFUSE_URL, "_blank", "noopener,noreferrer");
  };
  const style = {
    display: "flex",
    alignItems: "center",
    justifyContent: props.wide ? "flex-start" : "center",
    gap: 8,
    width: "100%",
    padding: props.wide ? "6px 10px" : "6px 0",
    border: "none",
    background: hovered ? "rgba(127, 127, 127, 0.14)" : "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1.4,
    borderRadius: 6,
    fontFamily: "inherit"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      onClick: openLangfuse,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style,
      title: "Open Langfuse",
      "aria-label": "Open Langfuse",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "15", height: "15", viewBox: "0 0 16 16", "aria-hidden": "true", style: { flexShrink: 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 1 L15 8 L8 15 L1 8 Z", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" }) }),
        props.wide ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Langfuse" }) : null
      ]
    }
  );
}
return module.exports; } });
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY2xpZW50L2luZGV4LnRzeCJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBkc2gtbGFuZ2Z1c2UtcGx1cyBjbGllbnQgXHU1MzRBIFx1MjAxNFx1MjAxNCBEU0ggXHU0RkE3XHU2ODBGIExhbmdmdXNlIFx1NTE2NVx1NTNFM1x1NjMwOVx1OTRBRVx1MzAwMlxuICpcbiAqIFx1NkNFOFx1NTE4Q1x1NTIzMCBzaWRlYmFyLmZvb3Rlci5hY3Rpb24gXHU2M0QyXHU2OUZEXHVGRjBDd2lkZSBcdTYzQTdcdTUyMzZcdTVCQkQvXHU3QTg0XHU0RkE3XHU2ODBGXHU2NjNFXHU3OTNBXHVGRjA4XHU2NTg3XHU1QjU3L1x1NEVDNVx1NTZGRVx1NjgwN1x1RkYwOVx1MzAwMlxuICogXHU5NkY2IERTSCBcdThGRDBcdTg4NENcdTY1RjZcdTRGOURcdThENTZcdUZGMUFcdTUzRUFcdTZDRThcdTUxNjUgY3R4LnNsb3RzXHVGRjBDXHU0RTBEIGltcG9ydCBkc2gtY2xpZW50LSogXHU4RkQwXHU4ODRDXHU2NUY2XHU0RUUzXHU3ODAxXG4gKiBcdUZGMDh0eXBlLW9ubHlcdUZGMENcdTY3ODRcdTVFRkFcdTY1RjZcdTY0RTZcdTk2NjRcdUZGMDlcdUZGMUJcdTRFQzUgcmVhY3QvanN4LXJ1bnRpbWUgXHU0RTI0XHU0RTJBIGV4dGVybmFsXHUzMDAyXG4gKi9cbmltcG9ydCB7IHVzZVN0YXRlLCB0eXBlIENTU1Byb3BlcnRpZXMgfSBmcm9tICdyZWFjdCdcblxuLyoqIFx1OERGM1x1OEY2Q1x1NTczMFx1NTc0MFx1RkYxQWJ1aWxkLWNsaWVudC5tanMgXHU2Nzg0XHU1RUZBXHU2NzFGXHU2Q0U4XHU1MTY1XHVGRjA4RFNIX0xBTkdGVVNFX0JBU0VfVVJMIC8gRFNIX0xBTkdGVVNFX1BST0pFQ1RfSURcdUZGMDlcdTMwMDIgKi9cbmRlY2xhcmUgY29uc3QgX19MQU5HRlVTRV9VUkxfXzogc3RyaW5nXG5jb25zdCBMQU5HRlVTRV9VUkwgPSBfX0xBTkdGVVNFX1VSTF9fXG5cbmV4cG9ydCBjb25zdCBpbmplY3QgPSBbJ3Nsb3RzJ11cblxuLyoqIFx1NkNFOFx1NTE4Q1x1NEZBN1x1NjgwRlx1NjMwOVx1OTRBRVx1RkYwQ1x1OEZENFx1NTZERSBzbG90cyBkaXNwb3Nlclx1RkYwOFx1NTM3OFx1OEY3RFx1NjVGNlx1NjQ1OFx1OTY2NFx1NjlGRFx1NEY0RFx1RkYwOVx1MzAwMiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5KGN0eDogYW55KTogKCkgPT4gdm9pZCB7XG4gIHJldHVybiBjdHguc2xvdHMucmVnaXN0ZXIoXG4gICAge1xuICAgICAgbmFtZTogJ3NpZGViYXIuZm9vdGVyLmFjdGlvbicsXG4gICAgICBpZDogJ2xhbmdmdXNlJyxcbiAgICAgIG9yZGVyOiAxMDAsXG4gICAgfSxcbiAgICBMYW5nZnVzZUZvb3RlckFjdGlvbixcbiAgKVxufVxuXG5mdW5jdGlvbiBMYW5nZnVzZUZvb3RlckFjdGlvbihwcm9wczogeyB3aWRlOiBib29sZWFuIH0pOiBKU1guRWxlbWVudCB7XG4gIGNvbnN0IFtob3ZlcmVkLCBzZXRIb3ZlcmVkXSA9IHVzZVN0YXRlKGZhbHNlKVxuXG4gIGNvbnN0IG9wZW5MYW5nZnVzZSA9ICgpOiB2b2lkID0+IHtcbiAgICB3aW5kb3cub3BlbihMQU5HRlVTRV9VUkwsICdfYmxhbmsnLCAnbm9vcGVuZXIsbm9yZWZlcnJlcicpXG4gIH1cblxuICBjb25zdCBzdHlsZTogQ1NTUHJvcGVydGllcyA9IHtcbiAgICBkaXNwbGF5OiAnZmxleCcsXG4gICAgYWxpZ25JdGVtczogJ2NlbnRlcicsXG4gICAganVzdGlmeUNvbnRlbnQ6IHByb3BzLndpZGUgPyAnZmxleC1zdGFydCcgOiAnY2VudGVyJyxcbiAgICBnYXA6IDgsXG4gICAgd2lkdGg6ICcxMDAlJyxcbiAgICBwYWRkaW5nOiBwcm9wcy53aWRlID8gJzZweCAxMHB4JyA6ICc2cHggMCcsXG4gICAgYm9yZGVyOiAnbm9uZScsXG4gICAgYmFja2dyb3VuZDogaG92ZXJlZCA/ICdyZ2JhKDEyNywgMTI3LCAxMjcsIDAuMTQpJyA6ICd0cmFuc3BhcmVudCcsXG4gICAgY29sb3I6ICdpbmhlcml0JyxcbiAgICBjdXJzb3I6ICdwb2ludGVyJyxcbiAgICBmb250U2l6ZTogMTMsXG4gICAgbGluZUhlaWdodDogMS40LFxuICAgIGJvcmRlclJhZGl1czogNixcbiAgICBmb250RmFtaWx5OiAnaW5oZXJpdCcsXG4gIH1cblxuICByZXR1cm4gKFxuICAgIDxidXR0b25cbiAgICAgIHR5cGU9XCJidXR0b25cIlxuICAgICAgb25DbGljaz17b3BlbkxhbmdmdXNlfVxuICAgICAgb25Nb3VzZUVudGVyPXsoKSA9PiBzZXRIb3ZlcmVkKHRydWUpfVxuICAgICAgb25Nb3VzZUxlYXZlPXsoKSA9PiBzZXRIb3ZlcmVkKGZhbHNlKX1cbiAgICAgIHN0eWxlPXtzdHlsZX1cbiAgICAgIHRpdGxlPVwiT3BlbiBMYW5nZnVzZVwiXG4gICAgICBhcmlhLWxhYmVsPVwiT3BlbiBMYW5nZnVzZVwiXG4gICAgPlxuICAgICAgPHN2ZyB3aWR0aD1cIjE1XCIgaGVpZ2h0PVwiMTVcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCIgc3R5bGU9e3sgZmxleFNocmluazogMCB9fT5cbiAgICAgICAgPHBhdGggZD1cIk04IDEgTDE1IDggTDggMTUgTDEgOCBaXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2VXaWR0aD1cIjEuNVwiIHN0cm9rZUxpbmVqb2luPVwicm91bmRcIiAvPlxuICAgICAgPC9zdmc+XG4gICAgICB7cHJvcHMud2lkZSA/IDxzcGFuPkxhbmdmdXNlPC9zcGFuPiA6IG51bGx9XG4gICAgPC9idXR0b24+XG4gIClcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFPQSxtQkFBNkM7QUE2Q3pDO0FBekNKLElBQU0sZUFBZTtBQUVkLElBQU0sU0FBUyxDQUFDLE9BQU87QUFHdkIsU0FBUyxNQUFNLEtBQXNCO0FBQzFDLFNBQU8sSUFBSSxNQUFNO0FBQUEsSUFDZjtBQUFBLE1BQ0UsTUFBTTtBQUFBLE1BQ04sSUFBSTtBQUFBLE1BQ0osT0FBTztBQUFBLElBQ1Q7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxxQkFBcUIsT0FBdUM7QUFDbkUsUUFBTSxDQUFDLFNBQVMsVUFBVSxRQUFJLHVCQUFTLEtBQUs7QUFFNUMsUUFBTSxlQUFlLE1BQVk7QUFDL0IsV0FBTyxLQUFLLGNBQWMsVUFBVSxxQkFBcUI7QUFBQSxFQUMzRDtBQUVBLFFBQU0sUUFBdUI7QUFBQSxJQUMzQixTQUFTO0FBQUEsSUFDVCxZQUFZO0FBQUEsSUFDWixnQkFBZ0IsTUFBTSxPQUFPLGVBQWU7QUFBQSxJQUM1QyxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxTQUFTLE1BQU0sT0FBTyxhQUFhO0FBQUEsSUFDbkMsUUFBUTtBQUFBLElBQ1IsWUFBWSxVQUFVLDhCQUE4QjtBQUFBLElBQ3BELE9BQU87QUFBQSxJQUNQLFFBQVE7QUFBQSxJQUNSLFVBQVU7QUFBQSxJQUNWLFlBQVk7QUFBQSxJQUNaLGNBQWM7QUFBQSxJQUNkLFlBQVk7QUFBQSxFQUNkO0FBRUEsU0FDRTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ0MsTUFBSztBQUFBLE1BQ0wsU0FBUztBQUFBLE1BQ1QsY0FBYyxNQUFNLFdBQVcsSUFBSTtBQUFBLE1BQ25DLGNBQWMsTUFBTSxXQUFXLEtBQUs7QUFBQSxNQUNwQztBQUFBLE1BQ0EsT0FBTTtBQUFBLE1BQ04sY0FBVztBQUFBLE1BRVg7QUFBQSxvREFBQyxTQUFJLE9BQU0sTUFBSyxRQUFPLE1BQUssU0FBUSxhQUFZLGVBQVksUUFBTyxPQUFPLEVBQUUsWUFBWSxFQUFFLEdBQ3hGLHNEQUFDLFVBQUssR0FBRSwyQkFBMEIsTUFBSyxRQUFPLFFBQU8sZ0JBQWUsYUFBWSxPQUFNLGdCQUFlLFNBQVEsR0FDL0c7QUFBQSxRQUNDLE1BQU0sT0FBTyw0Q0FBQyxVQUFLLHNCQUFRLElBQVU7QUFBQTtBQUFBO0FBQUEsRUFDeEM7QUFFSjsiLAogICJuYW1lcyI6IFtdCn0K
