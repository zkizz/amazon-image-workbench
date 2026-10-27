import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import {
  getAmazonPlannerProfile,
  validateApiProfile,
} from "../lib/apiProfiles";
import {
  buildApiUrl,
  readClientDevProxyConfig,
  shouldUseApiProxy,
} from "../lib/devProxy";
import { getApiErrorMessage } from "../lib/imageApiShared";
import MarkdownRenderer from "./MarkdownRenderer";
import { CopyIcon, ExternalLinkIcon, FavoriteIcon, TrashIcon } from "./icons";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[];
  favorite?: boolean;
};
type Chat = {
  id: string;
  title: string;
  pinned?: boolean;
  updatedAt: number;
  messages: Msg[];
};

const key = "amazon-image-workbench-reverse-prompt-chats";
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const makeChat = (): Chat => ({
  id: `reverse-${makeId()}`,
  title: "新建反推对话",
  updatedAt: Date.now(),
  messages: [],
});
const loadChats = (): Chat[] => {
  try {
    const chats = JSON.parse(localStorage.getItem(key) || "[]") as Chat[];
    return chats.length ? chats : [makeChat()];
  } catch {
    return [makeChat()];
  }
};

const toDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

function toPlainText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^(\s*)\d+[.)]\s+/gm, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .trim();
}

function getResponseText(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const value = data as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: unknown }> }>;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (typeof value.output_text === "string") return value.output_text;
  const text = value.output
    ?.flatMap((item) => item.content ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
  if (text) return text;
  const content = value.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((item) =>
        typeof item === "object" &&
        item &&
        "text" in item &&
        typeof item.text === "string"
          ? item.text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  return "";
}

function ChatMenu({
  chat,
  onPin,
  onRename,
  onRemove,
}: {
  chat: Chat;
  onPin: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="absolute right-1 top-8 z-20 w-28 rounded-lg border border-black/[0.10] bg-white p-1 shadow-lg dark:border-white/[0.12] dark:bg-[#292929]">
      <button
        type="button"
        onClick={onPin}
        className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-white/[0.08]"
      >
        {chat.pinned ? "取消置顶" : "置顶"}
      </button>
      <button
        type="button"
        onClick={onRename}
        className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-white/[0.08]"
      >
        重命名
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-400/[0.1]"
      >
        删除
      </button>
    </div>
  );
}

export default function ReversePromptPage() {
  const settings = useStore((s) => s.settings);
  const showToast = useStore((s) => s.showToast);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const fileRef = useRef<HTMLInputElement>(null);
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [active, setActive] = useState(() => chats[0].id);
  const [collapsed, setCollapsed] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<Msg | null>(null);
  const activeChat = chats.find((chat) => chat.id === active) ?? chats[0];
  const sorted = useMemo(
    () =>
      [...chats].sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
          b.updatedAt - a.updatedAt,
      ),
    [chats],
  );

  const save = (next: Chat[]) => {
    setChats(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const update = (id: string, fn: (chat: Chat) => Chat) =>
    save(chats.map((chat) => (chat.id === id ? fn(chat) : chat)));
  const create = () => {
    const chat = makeChat();
    save([chat, ...chats]);
    setActive(chat.id);
    setText("");
    setImages([]);
  };
  const rename = () => {
    const title = renameTitle.trim();
    if (renameId && title)
      update(renameId, (chat) => ({ ...chat, title, updatedAt: Date.now() }));
    setRenameId(null);
  };
  const remove = (chat: Chat) => {
    if (chats.length === 1 || !window.confirm(`删除对话“${chat.title}”？`))
      return;
    const next = chats.filter((item) => item.id !== chat.id);
    save(next);
    if (active === chat.id) setActive(next[0].id);
  };
  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const next = await Promise.all(
        Array.from(files)
          .filter((file) => file.type.startsWith("image/"))
          .map(toDataUrl),
      );
      setImages((current) => [...current, ...next]);
    } catch {
      showToast("附件读取失败，请重试", "error");
    }
  };
  const pasteImage = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData.files;
    if (!Array.from(files).some((file) => file.type.startsWith("image/")))
      return;
    event.preventDefault();
    void attach(files);
  };
  const updateMsg = (id: string, fn: (msg: Msg) => Msg) => {
    update(activeChat.id, (chat) => ({
      ...chat,
      messages: chat.messages.map((msg) => (msg.id === id ? fn(msg) : msg)),
      updatedAt: Date.now(),
    }));
  };
  const removeMsg = (id: string) => {
    update(activeChat.id, (chat) => ({
      ...chat,
      messages: chat.messages.filter((msg) => msg.id !== id),
      updatedAt: Date.now(),
    }));
  };
  const copyPrompt = async (value: string) => {
    try {
      await navigator.clipboard.writeText(toPlainText(value));
      showToast("提示词已复制", "success");
    } catch {
      showToast("复制失败，请在详情中手动复制", "error");
    }
  };
  const sendToGenerate = (value: string) => {
    useStore.getState().setPrompt(value);
    window.location.hash = "/generate";
  };
  const send = async () => {
    if (running || (!text.trim() && !images.length)) return;
    const profile = getAmazonPlannerProfile(settings);
    const error = profile ? validateApiProfile(profile) : "未找到 AI 策划配置";
    if (error || !profile || profile.apiMode === "images") {
      showToast(error || "反推提示词需要 Responses 或 Chat 配置", "error");
      setShowSettings(true);
      return;
    }
    const user: Msg = {
      id: makeId(),
      role: "user",
      text: text.trim() || "请反推这张图片的生成提示词。",
      images,
    };
    const history = [...activeChat.messages, user];
    update(activeChat.id, (chat) => ({
      ...chat,
      title: chat.messages.length ? chat.title : user.text.slice(0, 20),
      messages: history,
      updatedAt: Date.now(),
    }));
    setText("");
    setImages([]);
    setRunning(true);
    try {
      const proxy = readClientDevProxyConfig();
      const useProxy = shouldUseApiProxy(
        profile.apiProxy,
        proxy,
        profile.baseUrl,
      );
      const system =
        "你是专业的图片提示词反推助手。基于用户上传的图片和对话上下文，输出可直接用于生图的完整提示词。先给出中文提示词，再给出英文提示词；必要时补充负面提示词、构图、光线、镜头与材质细节。不要声称能识别图片中不可验证的事实。";
      const body =
        profile.apiMode === "chat"
          ? {
              model: profile.model,
              messages: [
                { role: "system", content: system },
                ...history.map((msg) => ({
                  role: msg.role,
                  content:
                    msg.role === "assistant"
                      ? msg.text
                      : [
                          { type: "text", text: msg.text },
                          ...(msg.images ?? []).map((url) => ({
                            type: "image_url",
                            image_url: { url },
                          })),
                        ],
                })),
              ],
              stream: false,
            }
          : {
              model: profile.model,
              instructions: system,
              input: history.map((msg) => ({
                role: msg.role,
                content:
                  msg.role === "assistant"
                    ? [{ type: "output_text", text: msg.text }]
                    : [
                        { type: "input_text", text: msg.text },
                        ...(msg.images ?? []).map((url) => ({
                          type: "input_image",
                          image_url: url,
                        })),
                      ],
              })),
            };
      const path =
        profile.apiMode === "chat" ? "chat/completions" : "responses";
      const response = await fetch(
        buildApiUrl(profile.baseUrl, path, proxy, useProxy, {
          prefixV1: profile.apiMode !== "chat",
        }),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${profile.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(await getApiErrorMessage(response));
      const answer =
        getResponseText(await response.json()) ||
        "未收到可用的反推结果，请调整描述后重试。";
      update(activeChat.id, (chat) => ({
        ...chat,
        messages: [
          ...chat.messages,
          { id: makeId(), role: "assistant", text: answer },
        ],
        updatedAt: Date.now(),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      update(activeChat.id, (chat) => ({
        ...chat,
        messages: [
          ...chat.messages,
          { id: makeId(), role: "assistant", text: `请求失败：${message}` },
        ],
        updatedAt: Date.now(),
      }));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section data-no-drag-select className="flex min-h-[calc(100vh-3.5rem)]">
      <aside
        className={`${collapsed ? "w-12 p-1.5" : "w-60 p-3"} relative shrink-0 border-r border-black/[0.08] bg-[#f7f7f8] transition-[width] dark:border-white/[0.08] dark:bg-[#171717]`}
        onClick={() => setMenuId(null)}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="h-9 w-9 rounded-md text-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-white/[0.08]"
          >
            ›
          </button>
        ) : (
          <>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={create}
                className="h-10 min-w-0 flex-1 rounded-lg bg-white px-3 text-left text-sm font-medium shadow-sm hover:bg-gray-100 dark:bg-white/[0.1]"
              >
                + 新建对话
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="h-10 w-8 rounded-lg text-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-white/[0.08]"
              >
                ‹
              </button>
            </div>
            <p className="px-2 pb-2 pt-5 text-[11px] font-medium text-gray-500">
              反推对话
            </p>
            <div className="space-y-1">
              {sorted.map((chat) => (
                <div
                  key={chat.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuId(chat.id);
                  }}
                  className={`relative rounded-lg px-2 ${chat.id === active ? "bg-gray-200/80 dark:bg-white/[0.12]" : "hover:bg-gray-200/60 dark:hover:bg-white/[0.08]"}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActive(chat.id);
                      setText("");
                      setImages([]);
                    }}
                    className="w-full truncate py-2 text-left text-sm"
                  >
                    {chat.pinned ? "置顶 · " : ""}
                    {chat.title}
                  </button>
                  {menuId === chat.id && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <ChatMenu
                        chat={chat}
                        onPin={() => {
                          update(chat.id, (item) => ({
                            ...item,
                            pinned: !item.pinned,
                          }));
                          setMenuId(null);
                        }}
                        onRename={() => {
                          setRenameId(chat.id);
                          setRenameTitle(chat.title);
                          setMenuId(null);
                        }}
                        onRemove={() => {
                          remove(chat);
                          setMenuId(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {renameId && (
              <form
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  rename();
                }}
                className="absolute bottom-3 left-3 right-3 z-30 rounded-lg border border-black/[0.10] bg-white p-2 shadow-lg dark:border-white/[0.12] dark:bg-[#292929]"
              >
                <input
                  autoFocus
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/[0.12]"
                />
                <div className="mt-2 flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setRenameId(null)}
                    className="rounded px-2 py-1 text-xs text-gray-500"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-gray-900 px-2 py-1 text-xs text-white dark:bg-white dark:text-gray-900"
                  >
                    保存
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </aside>
      <main className="relative flex min-w-0 flex-1 flex-col bg-white dark:bg-[#212121]">
        {activeChat.messages.length ? (
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 overflow-y-auto px-8 py-10">
            {activeChat.messages.map((msg, index) => {
              const source =
                msg.role === "assistant"
                  ? [...activeChat.messages.slice(0, index)]
                      .reverse()
                      .find(
                        (item) => item.role === "user" && item.images?.length,
                      )?.images?.[0]
                  : null;
              if (msg.role === "assistant")
                return (
                  <div
                    key={msg.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedMsg(msg)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSelectedMsg(msg);
                    }}
                    className="ios-card group flex h-40 w-full max-w-[30rem] cursor-pointer overflow-hidden hover:-translate-y-0.5 hover:shadow-[var(--ios-shadow-2)]"
                  >
                    <div className="relative h-full w-40 min-w-[10rem] shrink-0 overflow-hidden bg-gray-100 dark:bg-black/20">
                      {source ? (
                        <img
                          src={source}
                          alt="反推参考图"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-gray-400">
                          本轮无图片
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col p-3">
                      <div className="mb-2 text-xs font-medium text-gray-500">
                        反推提示词
                      </div>
                      <MarkdownRenderer
                        content={msg.text}
                        className="line-clamp-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300"
                      />
                      <div className="mt-3 text-xs text-gray-400">
                        点击查看完整提示词
                      </div>
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="mt-auto flex items-center gap-1 pt-2 text-gray-400"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            updateMsg(msg.id, (item) => ({
                              ...item,
                              favorite: !item.favorite,
                            }))
                          }
                          className={`rounded-md p-1.5 transition ${msg.favorite ? "text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-500/10" : "hover:bg-yellow-50 hover:text-yellow-400 dark:hover:bg-yellow-500/10"}`}
                          title="收藏"
                        >
                          <FavoriteIcon
                            filled={msg.favorite}
                            className="h-4 w-4"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyPrompt(msg.text)}
                          className="rounded-md p-1.5 transition hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-950/30"
                          title="复制提示词"
                        >
                          <CopyIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => sendToGenerate(msg.text)}
                          className="rounded-md p-1.5 transition hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-950/30"
                          title="转到通用生图"
                        >
                          <ExternalLinkIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMsg(msg.id)}
                          className="ml-auto rounded-md p-1.5 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                          title="删除"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              return (
                <div
                  key={msg.id}
                  className="ml-auto max-w-[82%] rounded-xl bg-gray-100 px-4 py-3 text-sm leading-7 text-gray-800 dark:bg-white/[0.10] dark:text-gray-100"
                >
                  {msg.images?.length ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {msg.images.map((src) => (
                        <img
                          key={src}
                          src={src}
                          alt="已上传图片"
                          className="h-24 w-24 rounded-md object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-8 pb-28">
            <h2 className="mb-3 text-3xl font-semibold text-gray-800 dark:text-gray-100">
              反推图片提示词
            </h2>
            <p className="mb-7 text-sm text-gray-500">
              上传图片，获取可继续修改的生图提示词
            </p>
          </div>
        )}
        <div
          className={`${activeChat.messages.length ? "sticky bottom-0 border-t border-black/[0.06] bg-white/95 px-8 py-5 dark:border-white/[0.08] dark:bg-[#212121]/95" : "absolute bottom-[12vh] left-1/2 w-full max-w-3xl -translate-x-1/2 px-8"}`}
        >
          <div className="mx-auto max-w-3xl">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void attach(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            {images.length ? (
              <div className="mb-3 flex gap-2">
                {images.map((src, index) => (
                  <div
                    key={src}
                    className="relative h-14 w-14 overflow-hidden rounded-md"
                  >
                    <img
                      src={src}
                      alt="待发送附件"
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setImages((list) =>
                          list.filter((_, item) => item !== index),
                        )
                      }
                      className="absolute right-0 top-0 h-5 w-5 bg-black/60 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="rounded-2xl border border-black/[0.12] bg-white p-3 shadow-[0_10px_35px_rgba(0,0,0,0.08)] dark:border-white/[0.12] dark:bg-[#252525]">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onPaste={pasteImage}
                placeholder="上传图片，或继续描述你想调整的提示词"
                className="min-h-24 w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none placeholder:text-gray-400 dark:text-gray-100"
              />
              <div className="mt-3 flex items-center justify-between border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="h-8 rounded-md px-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]"
                >
                  附件
                </button>
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={running || (!text.trim() && !images.length)}
                  className="h-9 w-9 rounded-full bg-gray-900 text-lg text-white disabled:bg-gray-200 dark:bg-white dark:text-gray-900"
                >
                  {running ? "…" : "↑"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      {selectedMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-8"
          onClick={() => setSelectedMsg(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="反推提示词详情"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-[#252525]"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold">反推提示词</h2>
              <button
                type="button"
                onClick={() => setSelectedMsg(null)}
                className="rounded-md px-2 py-1 text-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]"
              >
                ×
              </button>
            </div>
            <MarkdownRenderer
              content={selectedMsg.text}
              className="text-sm leading-7 text-gray-800 dark:text-gray-100"
            />
          </section>
        </div>
      )}
    </section>
  );
}
