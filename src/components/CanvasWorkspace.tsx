import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import AmazonPlanner from "./AmazonPlanner";
import { ensureImageCached, useStore } from "../store";
import {
  deleteAmazonPlannerSession,
  getAllAmazonPlannerSessions,
  putAmazonPlannerSession,
} from "../lib/db";
import type { AmazonPlannerSession, TaskParams } from "../types";
import { STYLE_PRESETS } from "../lib/stylePresets";

type Tone = "ready" | "waiting" | "missing";
type NodeData = {
  label: string;
  enabled: boolean;
  note: string;
  tone?: Tone;
  detail?: string;
  imageUrl?: string;
};
type PlannerState = {
  sessionId: string | null;
  plannerMode: "listing" | "aplus";
  marketplaceId: string;
  listingImageCount: number;
  resolution: "2k" | "4k";
  listingText: string;
  draft: Record<string, string>;
  referenceCount: number;
  referenceImages?: Array<{ id: string; dataUrl: string; kind: "product" | "type"; planSlot: string }>;
  styleLabel: string;
  params: TaskParams;
  customStyles?: Array<{ id: string; label: string; description: string; palette: string[] }>;
  imagePlans: Plan[];
  aPlusPlans: Plan[];
  isPlanning: boolean;
};
type Plan = {
  slot: string;
  label: string;
  planMarkdown: string;
  prompt: string;
  negativePrompt: string;
  generationSize?: string;
  uploadSize?: string;
};

const baseNodes: Node<NodeData>[] = [
  ["product", "产品资料", "目标类型、站点、图片数量与分辨率", 80, 80],
  [
    "profile",
    "Product Profile",
    "商品名称、类目、品牌、颜色、材质和人群",
    80,
    300,
  ],
  ["story", "Selling Story", "标题、五点描述、卖点、场景和禁用元素", 80, 520],
  ["reference", "参考图与风格", "产品参考图和视觉风格", 410, 80],
  ["planner", "AI 策划", "检查已连接信息后，自动生成图片方案", 760, 180],
  ["plans", "图片方案", "策划完成后拆分为可独立处理的方案", 1130, 180],
].map(([id, label, note, x, y]) => ({
  id: String(id),
  type: "workflow",
  position: { x: Number(x), y: Number(y) },
  data: {
    label: String(label),
    note: String(note),
    enabled: true,
    tone: "waiting",
  },
  style: { width: 260 },
}));

const baseEdges: Edge[] = [
  ["product", "planner"],
  ["profile", "planner"],
  ["story", "planner"],
  ["reference", "planner"],
  ["planner", "plans"],
].map(([source, target]) => ({
  id: `${source}-${target}`,
  source,
  target,
  animated: true,
}));
const tones: Record<Tone, { dot: string; label: string; text: string }> = {
  ready: { dot: "bg-emerald-500", label: "已完成", text: "text-emerald-700" },
  waiting: { dot: "bg-amber-400", label: "待确认", text: "text-amber-700" },
  missing: { dot: "bg-red-500", label: "待填写", text: "text-red-700" },
};
const send = (key: string, value: string) =>
  window.dispatchEvent(
    new CustomEvent("planner-node-update", { detail: { key, value } }),
  );

function getEventPoint(event: MouseEvent | TouchEvent) {
  const point = "touches" in event ? event.changedTouches[0] : event;
  return { x: point.clientX, y: point.clientY };
}

function FlowNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const { setNodes } = useReactFlow();
  const tone = tones[data.tone ?? "waiting"];
  return (
    <div
      className={`min-w-[220px] rounded-lg border bg-[hsl(var(--surface))] shadow-sm ${selected ? "border-blue-500 ring-2 ring-blue-500/20" : "border-black/[0.09] dark:border-white/[0.13]"}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-gray-500"
      />
      <div className="flex items-center justify-between border-b border-black/[0.07] px-3 py-2.5 dark:border-white/[0.08]">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {data.label}
        </span>
        <label className="nodrag flex items-center gap-1.5 text-[11px] text-gray-500">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={() =>
              setNodes((ns) =>
                ns.map((n) =>
                  n.id === id
                    ? { ...n, data: { ...n.data, enabled: !n.data.enabled } }
                    : n,
                ),
              )
            }
          />
          启用
        </label>
      </div>
      <div className="px-3 py-3">
        <div
          className={`flex items-center gap-2 text-xs font-medium ${tone.text}`}
        >
          <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
          {data.enabled ? tone.label : "已停用"}
        </div>
        <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {data.detail || data.note}
        </p>
        {data.imageUrl && <img src={data.imageUrl} alt="生成结果" className="mt-3 aspect-square w-full rounded-md object-cover" />}
        <p className="mt-3 text-[11px] text-gray-400">
          点击节点，在画布上方编辑
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-gray-500"
      />
    </div>
  );
}
const nodeTypes = { workflow: FlowNode };
function Field({
  label,
  value,
  onChange,
  area = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  area?: boolean;
}) {
  const cn =
    "mt-1 w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-800 outline-none focus:border-blue-500 dark:border-white/[0.12] dark:bg-white/[0.05] dark:text-gray-100";
  return (
    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
      {label}
      {area ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${cn} min-h-20 resize-y`}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn}
        />
      )}
    </label>
  );
}

function Editor({
  id,
  state,
  close,
  onStyleInfo,
}: {
  id: string;
  state: PlannerState;
  close: () => void;
  onStyleInfo: (style: { label: string; description: string; palette: string[] }) => void;
}) {
  const d = state.draft;
  const [editPrompt, setEditPrompt] = useState("");
  let title = "节点信息";
  let body: React.ReactNode = (
    <p className="text-sm text-gray-600">
      该节点将承接前一步的独立输出。图片方案与生成、编辑操作会继续在同一会话内保留。
    </p>
  );
  if (id === "product") {
    title = "编辑产品资料";
    body = (
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-gray-600">
          图片类型
          <select
            value={state.plannerMode}
            onChange={(e) => send("mode", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm"
          >
            <option value="listing">Listing 图</option>
            <option value="aplus">A+ 图</option>
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          目标站点
          <select
            value={state.marketplaceId}
            onChange={(e) => send("marketplace", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm"
          >
            <option value="US">美国站</option>
            <option value="JP">日本站</option>
            <option value="DE">德国站</option>
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          图片数量
          <select
            value={state.listingImageCount}
            onChange={(e) => send("count", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm"
          >
            {[7, 8, 9, 10, 11, 12].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <div>
          <span className="text-xs font-medium text-gray-600">生成规格</span>
          <div className="mt-1 flex gap-2">
            {(["2k", "4k"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => send("resolution", r)}
                className={`rounded-md border px-3 py-2 text-sm ${state.resolution === r ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200"}`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (id === "profile") {
    title = "编辑 Product Profile";
    body = (
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="商品名称"
          value={d.productTitle || ""}
          onChange={(v) => send("productTitle", v)}
        />
        <Field
          label="类目"
          value={d.category || ""}
          onChange={(v) => send("category", v)}
        />
        <Field
          label="品牌 / 型号"
          value={d.brand || ""}
          onChange={(v) => send("brand", v)}
        />
        <Field
          label="颜色"
          value={d.color || ""}
          onChange={(v) => send("color", v)}
        />
        <Field
          label="材质"
          value={d.material || ""}
          onChange={(v) => send("material", v)}
        />
        <Field
          label="目标人群"
          value={d.audience || ""}
          onChange={(v) => send("audience", v)}
        />
      </div>
    );
  }
  if (id === "story") {
    title = "编辑 Selling Story";
    body = (
      <div className="grid gap-3">
        <Field
          label="标题与五点描述"
          value={state.listingText}
          onChange={(v) => send("listing", v)}
          area
        />
        <Field
          label="Selling Story"
          value={d.sellingPoints || ""}
          onChange={(v) => send("sellingPoints", v)}
          area
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="包装清单"
            value={d.packageIncludes || ""}
            onChange={(v) => send("packageIncludes", v)}
            area
          />
          <Field
            label="场景 / 构图"
            value={d.scene || ""}
            onChange={(v) => send("scene", v)}
            area
          />
        </div>
        <Field
          label="禁用元素"
          value={d.forbidden || ""}
          onChange={(v) => send("forbidden", v)}
        />
      </div>
    );
  }
  if (id === "reference") {
    title = "编辑参考图与风格";
    body = (
      <div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          当前已上传 {state.referenceCount} 张产品参考图
          {state.styleLabel
            ? `，已选风格：${state.styleLabel}`
            : "，尚未选择风格参考"}
          。
        </p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("planner-node-upload"))}
          className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
        >
          上传参考图
        </button>
        {state.referenceImages?.length ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {state.referenceImages.map((image, index) => (
              <div key={image.id} className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.12] dark:bg-white/[0.05]">
                <img src={image.dataUrl} alt={`参考图 ${index + 1}`} className="aspect-square w-full object-cover" />
                <div className="p-1.5">
                  <select
                    value={image.kind}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => window.dispatchEvent(new CustomEvent("planner-node-reference-kind", { detail: { imageId: image.id, kind: event.target.value } }))}
                    className="nodrag nowheel w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-700 dark:border-white/[0.12] dark:bg-[#242424] dark:text-gray-200"
                    aria-label={`参考图 ${index + 1} 类型`}
                  >
                    <option value="product">产品设计图</option>
                    <option value="type">类型参考图</option>
                  </select>
                  {image.kind === "type" ? (
                    <select
                      value={image.planSlot}
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) => window.dispatchEvent(new CustomEvent("planner-node-reference-plan", { detail: { imageId: image.id, planSlot: event.target.value } }))}
                      className="nodrag nowheel mt-1 w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-700 dark:border-white/[0.12] dark:bg-[#242424] dark:text-gray-200"
                      aria-label={`参考图 ${index + 1} 对应的图片方案`}
                    >
                      <option value="">适用于全部 PT</option>
                      {(state.imagePlans.length
                        ? state.imagePlans.map((plan) => plan.slot)
                        : state.aPlusPlans.length
                          ? state.aPlusPlans.map((plan) => plan.slot)
                          : Array.from({ length: state.listingImageCount }, (_, index) => `PT${String(index + 1).padStart(2, "0")}`)
                      ).map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                    </select>
                  ) : null}
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => window.dispatchEvent(new CustomEvent("planner-node-reference-delete", { detail: { imageId: image.id } }))} className="nodrag nowheel mt-1 w-full rounded border border-red-200 px-1.5 py-1 text-[11px] text-red-600 hover:bg-red-50 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-400/10">删除</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
          <div className="mt-6">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            视觉风格
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => { window.dispatchEvent(new CustomEvent("planner-node-style", { detail: { presetId: preset.id } })); onStyleInfo({ label: preset.label, description: preset.description, palette: preset.palette }); }}
                className={`rounded-md border px-2 py-2 text-left text-xs ${state.styleLabel === preset.label ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:bg-gray-50 dark:border-white/[0.12] dark:hover:bg-white/[0.06]"}`}
              >
                <span className="block font-semibold">{preset.label}</span>
                <span className="mt-1 line-clamp-2 block text-[11px] text-gray-500">
                  {preset.description}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-4 border-t border-black/[0.08] pt-4 dark:border-white/[0.08]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">我的风格</span>
              <button type="button" onClick={() => window.dispatchEvent(new Event("planner-node-custom-style-new"))} className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200">新建自定义风格</button>
            </div>
            {state.customStyles?.length ? (
              <div className="grid grid-cols-2 gap-2">
                {state.customStyles.map((style) => (
                  <div key={style.id} className={`overflow-hidden rounded-md border text-xs ${state.styleLabel === style.label ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 dark:border-white/[0.12]"}`}>
                    <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("planner-node-custom-style", { detail: { styleId: style.id } })); onStyleInfo(style); }} className="block w-full px-2 py-2 text-left font-medium hover:bg-black/[0.03] dark:hover:bg-white/[0.06]">{style.label}</button>
                    <div className="grid grid-cols-2 border-t border-black/[0.07] dark:border-white/[0.08]">
                      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("planner-node-custom-style-edit", { detail: { styleId: style.id } }))} className="px-2 py-1.5 text-gray-600 hover:bg-black/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.06]">编辑</button>
                      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("planner-node-custom-style-delete", { detail: { styleId: style.id } }))} className="border-l border-black/[0.07] px-2 py-1.5 text-red-600 hover:bg-red-50 dark:border-white/[0.08] dark:text-red-300 dark:hover:bg-red-400/10">删除</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">可先从上方预设编辑，或直接新建一套可持续保存的风格。</p>}
          </div>
        </div>
      </div>
    );
  }
  if (id.startsWith("plan-")) {
    const index = Number(id.slice(5)) - 1;
    const plan = [...state.imagePlans, ...state.aPlusPlans][index];
    title = plan ? `${plan.slot} · ${plan.label}` : "图片方案";
    body = plan ? (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-white/[0.08]">尺寸 {plan.generationSize || `${state.resolution.toUpperCase()} 方图`}</span>
          {plan.uploadSize && <span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-white/[0.08]">上传 {plan.uploadSize}</span>}
          <select value={state.params.quality} onChange={(e) => send("quality", e.target.value)} className="rounded-md bg-gray-100 px-2 py-1 dark:bg-white/[0.08]"><option value="auto">质量：自动</option><option value="low">质量：低</option><option value="medium">质量：中</option><option value="high">质量：高</option></select>
          <select value={state.params.output_format} onChange={(e) => send("format", e.target.value)} className="rounded-md bg-gray-100 px-2 py-1 dark:bg-white/[0.08]"><option value="jpeg">JPEG</option><option value="png">PNG</option><option value="webp">WEBP</option></select>
          <select value={state.params.n} onChange={(e) => send("n", e.target.value)} className="rounded-md bg-gray-100 px-2 py-1 dark:bg-white/[0.08]"><option value="1">数量：1</option><option value="2">数量：2</option><option value="3">数量：3</option><option value="4">数量：4</option></select>
          <input value={state.params.output_compression ?? ''} onChange={(e) => send("compression", e.target.value)} className="w-14 rounded-md bg-gray-100 px-2 py-1 dark:bg-white/[0.08]" placeholder="压缩率" />
          <select value={state.params.moderation} onChange={(e) => send("moderation", e.target.value)} className="rounded-md bg-gray-100 px-2 py-1 dark:bg-white/[0.08]"><option value="auto">审核：自动</option><option value="low">审核：低</option></select>
        </div>
        <div><div className="mb-1 text-xs font-semibold text-gray-500">方案说明</div><p className="whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-gray-200">{plan.planMarkdown}</p></div>
        <label className="block text-xs font-semibold text-gray-500">提示词<textarea value={plan.prompt} onChange={(event) => window.dispatchEvent(new CustomEvent("planner-node-plan-update", { detail: { index, field: "prompt", value: event.target.value } }))} className="mt-1 h-40 w-full resize-y rounded-md border border-gray-200 bg-white p-2.5 font-mono text-xs leading-5 text-gray-700 outline-none focus:border-blue-500 dark:border-white/[0.12] dark:bg-white/[0.05] dark:text-gray-200" /></label>
        <label className="block text-xs font-semibold text-gray-500">负向提示词<textarea value={plan.negativePrompt} onChange={(event) => window.dispatchEvent(new CustomEvent("planner-node-plan-update", { detail: { index, field: "negativePrompt", value: event.target.value } }))} className="mt-1 h-20 w-full resize-y rounded-md border border-gray-200 bg-white p-2.5 font-mono text-xs leading-5 text-gray-700 outline-none focus:border-blue-500 dark:border-white/[0.12] dark:bg-white/[0.05] dark:text-gray-200" /></label>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("planner-node-plan-generate", { detail: { index } }))} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">生成此图片</button>
      </div>
    ) : <p className="text-sm text-gray-500">方案数据正在加载。</p>;
  }
  if (id.startsWith("result-")) {
    title = "生成结果";
    body = (
      <div className="space-y-4">
        <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">该结果已保留在通用生图的任务卡片中，卡片内可查看提示词、尺寸、审核、数量、耗时和生成图片，并可继续编辑或重新生成。</p>
        <button type="button" onClick={() => { window.location.hash = "/generate" }} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">打开生成结果卡片</button>
      </div>
    );
  }
  if (id.startsWith("edit-")) {
    title = "编辑图片";
    body = (
      <div className="space-y-4">
        <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-white/[0.05] dark:text-gray-300">
          从上游生图结果中选择图片，或上传新的编辑参考图。
        </div>
        <Field
          label="编辑指令"
          value={editPrompt}
          onChange={setEditPrompt}
          area
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => (window.location.hash = "/editor")}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 dark:border-white/[0.15] dark:text-gray-200"
          >
            选择图片、遮罩与编辑参数
          </button>
          <button
            type="button"
            onClick={() => (window.location.hash = "/editor")}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            开始修改
          </button>
        </div>
      </div>
    );
  }
  if (id === "planner") {
    title = "AI 策划确认";
    const card = (
      label: string,
      detail: string,
      tone: "green" | "red" | "yellow",
    ) => (
      <div
        className={`rounded-xl px-4 py-3 ${tone === "green" ? "bg-emerald-50 text-emerald-800" : tone === "red" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}
      >
        <div className="text-base font-semibold">{label}</div>
        <div className="mt-1 text-sm opacity-80">{detail}</div>
      </div>
    );
    body = (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          {card(
            "目标站点",
            state.marketplaceId === "US" ? "美国站" : state.marketplaceId,
            "green",
          )}
          {card(
            "商品名称",
            d.productTitle?.trim() || "等待 AI 从 Listing 解析",
            d.productTitle?.trim() ? "green" : "red",
          )}
          {card("图片规格", `${state.resolution.toUpperCase()} 方图`, "green")}
          {card(
            "参考图",
            state.referenceCount
              ? `${state.referenceCount} 张产品参考图`
              : "尚未上传产品参考图",
            state.referenceCount ? "green" : "yellow",
          )}
          {card(
            "风格参考",
            state.styleLabel || "正式生成前请选择风格参考",
            state.styleLabel ? "green" : "yellow",
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new Event("planner-node-confirm"))
            }
            className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700"
          >
            确认信息
          </button>
          <button
            type="button"
            disabled={state.isPlanning}
            onClick={() => window.dispatchEvent(new Event("planner-node-run"))}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {state.isPlanning ? "策划中..." : "开始 AI 策划"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <aside className="absolute left-1/2 top-5 z-20 w-[min(720px,calc(100%-48px))] -translate-x-1/2 rounded-xl border border-black/[0.10] bg-white shadow-2xl dark:border-white/[0.12] dark:bg-[#242424]">
      <div className="flex items-center justify-between border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            填写内容保存在当前策划会话中
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded-md px-2 py-1 text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ×
        </button>
      </div>
      <div className="max-h-[65vh] overflow-auto p-5">{body}</div>
    </aside>
  );
}

function ChatList({
  collapsed,
  toggle,
}: {
  collapsed: boolean;
  toggle: () => void;
}) {
  const [items, setItems] = useState<AmazonPlannerSession[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const load = useCallback(() => {
    getAllAmazonPlannerSessions().then((xs) =>
      setItems(
        [...xs].sort(
          (a, b) =>
            Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
            b.updatedAt - a.updatedAt,
        ),
      ),
    );
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("planner-session-change", load);
    return () => window.removeEventListener("planner-session-change", load);
  }, [load]);
  const change = async (
    s: AmazonPlannerSession,
    p: Partial<AmazonPlannerSession>,
  ) => {
    await putAmazonPlannerSession({ ...s, ...p, updatedAt: Date.now() });
    load();
  };
  if (collapsed)
    return (
      <aside className="absolute bottom-0 left-0 top-0 z-10 w-12 border-r border-black/[0.08] bg-[#f7f7f8] p-1.5 dark:border-white/[0.08] dark:bg-[#171717]">
        <button
          type="button"
          onClick={toggle}
          className="h-9 w-9 rounded-md text-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-white/[0.08]"
          title="展开会话"
        >
          ›
        </button>
      </aside>
    );
  const saveRename = () => {
    const s = items.find((item) => item.id === renameId);
    const title = renameTitle.trim();
    if (s && title) void change(s, { title, manualTitle: true });
    setRenameId(null);
  };
  const remove = (s: AmazonPlannerSession) => {
    if (window.confirm(`删除会话“${s.title}”？`))
      void deleteAmazonPlannerSession(s.id).then(load);
  };
  return (
    <aside
      className="absolute bottom-0 left-0 top-0 z-10 flex w-60 flex-col border-r border-black/[0.08] bg-[#f7f7f8] p-3 dark:border-white/[0.08] dark:bg-[#171717]"
      onClick={() => setMenuId(null)}
    >
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("planner-session-new"))}
          className="h-10 min-w-0 flex-1 rounded-lg bg-white px-3 text-left text-sm font-medium shadow-sm hover:bg-gray-100 dark:bg-white/[0.1]"
        >
          + 新建聊天
        </button>
        <button
          type="button"
          onClick={toggle}
          className="h-10 w-8 rounded-lg text-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-white/[0.08]"
          title="收起会话"
        >
          ‹
        </button>
      </div>
      <p className="px-2 pb-2 pt-5 text-[11px] font-medium text-gray-500">
        策划项目
      </p>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {items.map((s) => (
          <div
            key={s.id}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuId(s.id);
            }}
            className="relative rounded-lg px-2 hover:bg-gray-200/60 dark:hover:bg-white/[0.08]"
          >
            {renameId === s.id ? <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); saveRename(); }} className="flex items-center gap-1 py-1"><input autoFocus value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setRenameId(null) }} className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-white/[0.12] dark:bg-[#292929]"/><button type="submit" className="rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]">保存</button><button type="button" onClick={() => setRenameId(null)} className="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]">取消</button></form> : <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("planner-session-open", { detail: s }),
                )
              }
              className="w-full truncate py-2 text-left text-sm text-gray-800 dark:text-gray-200"
            >
              {s.pinned ? "置顶 · " : ""}
              {s.title}
            </button>}
            {menuId === s.id && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-1 top-8 z-20 w-28 rounded-lg border border-black/[0.10] bg-white p-1 shadow-lg dark:border-white/[0.12] dark:bg-[#292929]"
              >
                <button
                  type="button"
                  onClick={() => {
                    void change(s, { pinned: !s.pinned });
                    setMenuId(null);
                  }}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-white/[0.08]"
                >
                  {s.pinned ? "取消置顶" : "置顶"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenameId(s.id);
                    setRenameTitle(s.title);
                    setMenuId(null);
                  }}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-white/[0.08]"
                >
                  重命名
                </button>
                <button
                  type="button"
                  onClick={() => {
                    remove(s);
                    setMenuId(null);
                  }}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-400/[0.1]"
                >
                  删除
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function getInfo(s: PlannerState) {
  const d = s.draft;
  const plans = s.imagePlans.length + s.aPlusPlans.length;
  return {
    product: {
      tone: "ready" as Tone,
      detail: `${s.plannerMode === "aplus" ? "A+ 图" : "Listing 图"} · ${s.marketplaceId} · ${s.listingImageCount} 张 · ${s.resolution.toUpperCase()}`,
    },
    profile: d.productTitle?.trim()
      ? {
          tone: "ready" as Tone,
          detail: `${d.productTitle}${d.category ? ` · ${d.category}` : ""}`,
        }
      : { tone: "missing" as Tone, detail: "需要填写商品名称" },
    story: s.listingText.trim()
      ? { tone: "ready" as Tone, detail: "标题与五点描述已填写" }
      : { tone: "missing" as Tone, detail: "需要填写标题与五点描述" },
    reference: s.referenceCount
      ? {
          tone: s.styleLabel ? ("ready" as Tone) : ("waiting" as Tone),
          detail: `${s.referenceCount} 张参考图${s.styleLabel ? ` · ${s.styleLabel}` : " · 风格待确认"}`,
        }
      : { tone: "waiting" as Tone, detail: "可上传产品参考图并选择风格" },
    planner:
      d.productTitle?.trim() && s.listingText.trim()
        ? {
            tone: s.isPlanning ? ("waiting" as Tone) : ("ready" as Tone),
            detail: s.isPlanning
              ? "正在生成图片方案"
              : "输入已完成，可以开始策划",
          }
        : { tone: "missing" as Tone, detail: "等待商品名称与五点描述" },
    plans: plans
      ? { tone: "ready" as Tone, detail: `已生成 ${plans} 个独立方案` }
      : { tone: "waiting" as Tone, detail: "等待 AI 策划输出" },
  };
}

export default function CanvasWorkspace({
  navCollapsed,
}: {
  navCollapsed: boolean;
}) {
  const tasks = useStore((store) => store.tasks);
  const setDetailTaskId = useStore((store) => store.setDetailTaskId);
  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges);
  const [unlinked, setUnlinked] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [state, setState] = useState<PlannerState>({
    plannerMode: "listing",
    sessionId: null,
    marketplaceId: "US",
    listingImageCount: 7,
    resolution: "2k",
    listingText: "",
    draft: {},
    referenceCount: 0,
    styleLabel: "",
    params: { size: "auto", quality: "auto", output_format: "jpeg", output_compression: 70, moderation: "auto", n: 1 },
    imagePlans: [],
    aPlusPlans: [],
    isPlanning: false,
  });
  const [styleInfo, setStyleInfo] = useState<{ label: string; description: string; palette: string[] } | null>(null);
  const info = useMemo(() => getInfo(state), [state]);
  const connect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, animated: true }, es)),
    [setEdges],
  );
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removed = changes.filter((change) => change.type === "remove").map((change) => change.id);
    if (removed.length) setUnlinked((current) => new Set([...current, ...removed]));
    onEdgesChange(changes);
  }, [onEdgesChange]);
  const createEditor = useCallback(
    (point: { x: number; y: number }) => {
      const id = `edit-${Date.now()}`;
      setNodes((ns) => [
        ...ns,
        {
          id,
          type: "workflow",
          position: point,
          data: {
            label: "图片编辑",
            enabled: true,
            note: "选择结果图片后填写编辑指令",
            tone: "waiting",
          },
          style: { width: 270 },
        },
      ]);
      setEdges((es) => [
        ...es,
        { id: `results-${id}`, source: "results", target: id, animated: true },
      ]);
      setSelected(id);
    },
    [setEdges, setNodes],
  );
  useEffect(() => {
    const sync = (e: Event) =>
      setState((e as CustomEvent<PlannerState>).detail);
    window.addEventListener("planner-node-state", sync);
    return () => window.removeEventListener("planner-node-state", sync);
  }, []);
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) =>
        info[n.id as keyof typeof info]
          ? { ...n, data: { ...n.data, ...info[n.id as keyof typeof info] } }
          : n,
      ),
    );
  }, [info, setNodes]);
  useEffect(() => {
    const plans = [...state.imagePlans, ...state.aPlusPlans];
    setNodes((ns) => {
      const existing = new Map(ns.map((node) => [node.id, node]));
      return [
      ...ns.filter((node) => !node.id.startsWith("plan-")),
      ...plans.map((plan, index) => ({
        id: `plan-${index + 1}`,
        type: "workflow",
        position: existing.get(`plan-${index + 1}`)?.position ?? { x: 1130, y: 290 + index * 430 },
        data: { label: `${plan.slot} · ${plan.label}`, enabled: true, note: plan.planMarkdown || "AI 已输出此图片方案，点击查看", detail: `尺寸 ${plan.generationSize || state.resolution.toUpperCase()} · 点击查看提示词并生成`, tone: "ready" as Tone },
        style: { width: 270 },
      })),
    ]; });
    setEdges((es) => [
      ...es.filter((edge) => !edge.id.startsWith("plan-edge-")),
      ...plans.filter((_, index) => !unlinked.has(`plan-edge-${index + 1}`)).map((_, index) => ({ id: `plan-edge-${index + 1}`, source: "planner", target: `plan-${index + 1}`, animated: true, deletable: true })),
    ]);
  }, [setEdges, setNodes, state.aPlusPlans, state.imagePlans, state.resolution, unlinked]);
  useEffect(() => {
    const items = state.sessionId ? tasks.filter((task) =>
      (task.category?.workflow === "amazon-listing" || task.category?.workflow === "amazon-aplus") &&
      task.category?.conversationId === state.sessionId,
    ) : [];
    let cancelled = false;
    void Promise.all(items.map(async (task) => [task.id, task.outputImages[0] ? await ensureImageCached(task.outputImages[0]) : ""] as const)).then((images) => {
      if (cancelled) return;
      const imageMap = new Map(images);
      setNodes((ns) => {
        const existing = new Map(ns.map((node) => [node.id, node]));
        const plans = [...state.imagePlans, ...state.aPlusPlans];
        const roots = items.filter((task) => !task.category?.parentTaskId).sort((a, b) => a.createdAt - b.createdAt);
        const byId = new Map(items.map((task) => [task.id, task]));
        const positions = new Map<string, { x: number; y: number }>();
        const position = (task: typeof items[number]): { x: number; y: number } => {
          const saved = existing.get(`result-${task.id}`)?.position
          if (saved) return saved
          const cached = positions.get(task.id)
          if (cached) return cached
          const parentTask = task.category?.parentTaskId ? byId.get(task.category.parentTaskId) : null
          const parent: { x: number; y: number } | null = parentTask ? position(parentTask) : null
          if (parent) return { x: parent.x + 330, y: parent.y }
          const planIndex = plans.findIndex((plan) => plan.slot === task.category?.amazonSlot)
          const plan = existing.get(`plan-${planIndex + 1}`)?.position ?? { x: 1130, y: 290 + Math.max(planIndex, 0) * 430 }
          const sibling = roots.filter((item) => item.category?.amazonSlot === task.category?.amazonSlot).indexOf(task)
          const next = { x: plan.x + 330 * (sibling + 1), y: plan.y }
          positions.set(task.id, next)
          return next
        }
        return [
        ...ns.filter((node) => !node.id.startsWith("result-")),
        ...items.map((task) => ({
          id: `result-${task.id}`,
          type: "workflow",
          position: position(task),
          data: {
            label: `${task.category?.amazonSlot || "图片"} · ${task.status === "done" ? "已完成" : task.status === "running" ? "生成中" : "生成失败"}`,
            enabled: true,
            note: task.error || "点击查看任务详情，可继续编辑或重新生成",
            detail: `${task.outputImages.length} 张结果${task.elapsed != null ? ` · ${Math.max(1, Math.round(task.elapsed / 1000))} 秒` : " · 等待结果"}`,
            imageUrl: imageMap.get(task.id) || undefined,
            tone: task.status === "done" ? "ready" as Tone : task.status === "error" ? "missing" as Tone : "waiting" as Tone,
          },
          style: { width: 270 },
        })),
      ]; });
      const plans = [...state.imagePlans, ...state.aPlusPlans];
      setEdges((es) => [...es.filter((edge) => !edge.id.startsWith("result-edge-")), ...items.flatMap((task) => {
        if (unlinked.has(`result-edge-${task.id}`)) return [];
        if (task.category?.parentTaskId) return [{ id: `result-edge-${task.id}`, source: `result-${task.category.parentTaskId}`, target: `result-${task.id}`, animated: task.status === "running", deletable: true }];
        const index = plans.findIndex((plan) => plan.slot === task.category?.amazonSlot);
        return index < 0 ? [] : [{ id: `result-edge-${task.id}`, source: `plan-${index + 1}`, target: `result-${task.id}`, animated: task.status === "running", deletable: true }];
      })]);
    });
    return () => { cancelled = true; };
  }, [setEdges, setNodes, state.aPlusPlans, state.imagePlans, state.sessionId, tasks, unlinked]);
  return (
    <section
      className={`fixed inset-x-0 bottom-0 top-14 ${navCollapsed ? "lg:left-16" : "lg:left-64"}`}
      data-no-drag-select
    >
      <ChatList
        collapsed={chatCollapsed}
        toggle={() => setChatCollapsed((value) => !value)}
      />
      <div
        className={`${chatCollapsed ? "ml-12" : "ml-60"} h-full transition-[margin]`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={connect}
          onConnectStart={(_, value) => setLinkSource(value.nodeId)}
          onConnectEnd={(event) => {
            setLinkSource(null);
          }}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => {
            if (n.id.startsWith("result-")) setDetailTaskId(n.id.slice(7));
            else setSelected(n.id);
          }}
          onPaneClick={() => setSelected(null)}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={18} size={1} />
          <Controls />
          <MiniMap />
        </ReactFlow>
        {selected && (
          <Editor id={selected} state={state} close={() => setSelected(null)} onStyleInfo={setStyleInfo} />
        )}
      </div>
      {styleInfo && <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setStyleInfo(null)}><div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-[#242424]" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{styleInfo.label}</h2><p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{styleInfo.description}</p></div><button type="button" onClick={() => setStyleInfo(null)} className="text-xl text-gray-400">×</button></div><div className="mt-4 flex gap-2">{styleInfo.palette.map((color) => <span key={color} className="h-10 flex-1 rounded-md border border-black/10" style={{ backgroundColor: color }} />)}</div><p className="mt-3 text-xs text-gray-500 dark:text-gray-400">该风格会同时写入提示词，并作为隐藏参考图附加到生成请求。</p></div></div>}
      <AmazonPlanner embedded />
    </section>
  );
}
