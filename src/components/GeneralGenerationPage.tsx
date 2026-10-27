import { useEffect, useMemo, useRef, useState } from "react";
import { addImageFromFile, submitTask, useStore } from "../store";
import TaskGrid from "./TaskGrid";

type Chat = { id: string; title: string; pinned?: boolean; updatedAt: number };
const key = "amazon-image-workbench-general-chats";
const makeChat = (): Chat => ({
  id: `general-${Date.now()}`,
  title: "新建生图对话",
  updatedAt: Date.now(),
});
const loadChats = (): Chat[] => {
  try {
    const list = JSON.parse(localStorage.getItem(key) || "[]") as Chat[];
    return list.length ? list : [makeChat()];
  } catch {
    return [makeChat()];
  }
};

function Composer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const prompt = useStore((s) => s.prompt);
  const params = useStore((s) => s.params);
  const images = useStore((s) => s.inputImages);
  const setPrompt = useStore((s) => s.setPrompt);
  const setParams = useStore((s) => s.setParams);
  const removeImage = useStore((s) => s.removeInputImage);
  const clearInputImages = useStore((s) => s.clearInputImages);
  const send = async () => {
    const submitted = await submitTask();
    if (submitted) {
      setPrompt("");
      clearInputImages();
    }
  };
  const pasteImage = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    event.preventDefault();
    files.forEach((file) => void addImageFromFile(file));
  };
  return (
    <div className="w-full max-w-3xl">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          Array.from(e.target.files || []).forEach((file) => {
            void addImageFromFile(file);
          });
          e.currentTarget.value = "";
        }}
      />
      {images.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto">
          {images.map((image, index) => (
            <div
              key={image.id}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md"
            >
              <img
                src={image.dataUrl}
                alt="参考图"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute right-0 top-0 h-5 w-5 bg-black/60 text-xs text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-black/[0.12] bg-white p-3 shadow-[0_10px_35px_rgba(0,0,0,0.08)] dark:border-white/[0.12] dark:bg-[#252525]">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={pasteImage}
          placeholder="描述你想生成的图片"
          className="min-h-24 w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none placeholder:text-gray-400 dark:text-gray-100"
        />
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={params.size}
              onChange={(e) => setParams({ size: e.target.value })}
              className="h-8 rounded-md bg-gray-100 px-2 text-xs dark:bg-white/[0.08]"
            >
              <option value="auto">尺寸：自动</option>
              <option value="1024x1024">1024 方图</option>
              <option value="1536x1024">1536 横图</option>
              <option value="1024x1536">1024 竖图</option>
            </select>
            <select
              value={params.quality}
              onChange={(e) =>
                setParams({ quality: e.target.value as typeof params.quality })
              }
              className="h-8 rounded-md bg-gray-100 px-2 text-xs dark:bg-white/[0.08]"
            >
              <option value="auto">质量：自动</option>
              <option value="low">质量：低</option>
              <option value="medium">质量：中</option>
              <option value="high">质量：高</option>
            </select>
            <select
              value={params.output_format}
              onChange={(e) =>
                setParams({
                  output_format: e.target.value as typeof params.output_format,
                })
              }
              className="h-8 rounded-md bg-gray-100 px-2 text-xs dark:bg-white/[0.08]"
            >
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
            <select
              value={params.n}
              onChange={(e) => setParams({ n: Number(e.target.value) })}
              className="h-8 rounded-md bg-gray-100 px-2 text-xs dark:bg-white/[0.08]"
            >
              <option value="1">数量：1</option>
              <option value="2">数量：2</option>
              <option value="3">数量：3</option>
              <option value="4">数量：4</option>
            </select>
            <input
              type="number"
              min="0"
              max="100"
              value={params.output_compression ?? ""}
              onChange={(e) =>
                setParams({
                  output_compression: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
              placeholder="压缩率"
              className="h-8 w-16 rounded-md bg-gray-100 px-2 text-xs dark:bg-white/[0.08]"
            />
            <select
              value={params.moderation}
              onChange={(e) =>
                setParams({
                  moderation: e.target.value as typeof params.moderation,
                })
              }
              className="h-8 rounded-md bg-gray-100 px-2 text-xs dark:bg-white/[0.08]"
            >
              <option value="auto">审核：自动</option>
              <option value="low">审核：低</option>
            </select>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-8 rounded-md px-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]"
              title="上传参考图"
            >
              附件
            </button>
          </div>
          <button
            type="button"
            onClick={send}
            disabled={!prompt.trim()}
            className="h-9 w-9 rounded-full bg-gray-900 text-lg text-white disabled:bg-gray-200 disabled:text-gray-400 dark:bg-white dark:text-gray-900"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GeneralGenerationPage() {
  const tasks = useStore((s) => s.tasks);
  const pending = useStore((s) => s.pendingTaskCategory);
  const setPending = useStore((s) => s.setPendingTaskCategory);
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [active, setActive] = useState(() => chats[0].id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const activeTasks = useMemo(
    () => tasks.filter((task) => task.category?.conversationId === active),
    [active, tasks],
  );
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(chats));
  }, [chats]);
  useEffect(() => {
    if (pending?.category.conversationId !== active)
      setPending({
        mode: "next-submit",
        category: { workflow: "gallery", conversationId: active },
      });
  }, [active, pending?.category.conversationId, setPending]);
  const create = () => {
    const chat = makeChat();
    setChats((list) => [chat, ...list]);
    setActive(chat.id);
  };
  const rename = (chat: Chat) => {
    setRenameId(chat.id);
    setRenameTitle(chat.title);
  };
  const saveRename = () => {
    const title = renameTitle.trim();
    if (renameId && title)
      setChats((list) =>
        list.map((item) =>
          item.id === renameId
            ? { ...item, title, updatedAt: Date.now() }
            : item,
        ),
      );
    setRenameId(null);
  };
  const remove = (chat: Chat) => {
    if (chats.length === 1 || !window.confirm(`删除对话“${chat.title}”？`))
      return;
    const next = chats.filter((item) => item.id !== chat.id);
    setChats(next);
    if (active === chat.id) setActive(next[0].id);
  };
  const togglePin = (chat: Chat) =>
    setChats((list) =>
      list.map((item) =>
        item.id === chat.id
          ? { ...item, pinned: !item.pinned, updatedAt: Date.now() }
          : item,
      ),
    );
  const sorted = [...chats].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      b.updatedAt - a.updatedAt,
  );
  return (
    <section data-no-drag-select className="flex min-h-[calc(100vh-3.5rem)]">
      <aside
        className={`${sidebarCollapsed ? "w-12 p-1.5" : "w-60 p-3"} relative shrink-0 border-r border-black/[0.08] bg-[#f7f7f8] transition-[width] dark:border-white/[0.08] dark:bg-[#171717]`}
        onClick={() => setMenuId(null)}
      >
        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="h-9 w-9 rounded-md text-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-white/[0.08]"
            title="展开生图对话"
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
                onClick={() => setSidebarCollapsed(true)}
                className="h-10 w-8 rounded-lg text-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-white/[0.08]"
                title="收起生图对话"
              >
                ‹
              </button>
            </div>
            <p className="px-2 pb-2 pt-5 text-[11px] font-medium text-gray-500">
              生图对话
            </p>
            <div className="space-y-1">
              {sorted.map((chat) => (
                <div
                  key={chat.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuId(chat.id);
                  }}
                  className={`relative rounded-lg px-2 ${active === chat.id ? "bg-gray-200/80 dark:bg-white/[0.12]" : "hover:bg-gray-200/60 dark:hover:bg-white/[0.08]"}`}
                >
                  {renameId === chat.id ? (
                    <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); saveRename(); }} className="flex items-center gap-1 py-1">
                      <input autoFocus value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setRenameId(null) }} className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-white/[0.12] dark:bg-[#292929]" />
                      <button type="submit" className="rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]">保存</button>
                      <button type="button" onClick={() => setRenameId(null)} className="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]">取消</button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActive(chat.id)}
                      className="w-full truncate py-2 text-left text-sm"
                    >
                      {chat.pinned ? "置顶 · " : ""}
                      {chat.title}
                    </button>
                  )}
                  {menuId === chat.id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-1 top-8 z-20 w-28 rounded-lg border border-black/[0.10] bg-white p-1 shadow-lg dark:border-white/[0.12] dark:bg-[#292929]"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          togglePin(chat);
                          setMenuId(null);
                        }}
                        className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-white/[0.08]"
                      >
                        {chat.pinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          rename(chat);
                          setMenuId(null);
                        }}
                        className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-white/[0.08]"
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          remove(chat);
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
          </>
        )}
      </aside>
      <main className="relative flex min-w-0 flex-1 flex-col">
        {activeTasks.length === 0 ? (
          <>
            <div className="flex flex-1 flex-col items-center justify-center px-8 pb-28">
              <h2 className="mb-3 text-3xl font-semibold text-gray-800 dark:text-gray-100">
                今天想创造什么？
              </h2>
              <p className="mb-7 text-sm text-gray-500">
                描述画面，或上传参考图开始生成
              </p>
            </div>
            <div className="absolute bottom-[12vh] left-1/2 w-full max-w-3xl -translate-x-1/2 px-8">
              <Composer />
            </div>
          </>
        ) : (
          <div className="mx-auto w-full max-w-5xl px-8 pb-64 pt-9">
            <TaskGrid conversationId={active} />
            <div className="fixed bottom-7 left-[calc(50%+7.5rem)] w-[min(48rem,calc(100%-20rem))] -translate-x-1/2">
              <Composer />
            </div>
          </div>
        )}
      </main>
    </section>
  );
}
