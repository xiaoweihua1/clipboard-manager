import { useState, useEffect, useCallback, useRef } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface ClipItem {
  text: string;
  id: number;
  time: number;
  expanded: boolean;
  type: "text" | "image";
  imageData?: string;
  pinned?: boolean;
}

const MAX_HISTORY = 150;
const MAX_IMAGES = 10;
const POLL_INTERVAL = 1500;

function App() {
  const [history, setHistory] = useState<ClipItem[]>([]);
  const lastTextRef = useRef<string>("");
  const lastImageRef = useRef<string>("");
  const [isPinned, setIsPinned] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId?: number } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const copyTimerRef = useRef<number | null>(null);
  const appWindow = getCurrentWindow();

  // 每分钟刷新时间显示
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const poll = async () => {
      if (!(await appWindow.isVisible())) return;
      try {
        const text = await readText();
        if (text && text !== lastTextRef.current) {
          lastTextRef.current = text;
          setHistory((prev) => {
            if (prev.length > 0 && prev[0].text === text) return prev;
            const newItem: ClipItem = { text, id: Date.now(), time: Date.now(), expanded: false, type: "text" };
            return [newItem, ...prev].slice(0, MAX_HISTORY);
          });
          return;
        }
      } catch {}

      try {
        const imgBase64: string | null = await invoke("read_clipboard_image");
        if (imgBase64 && imgBase64 !== lastImageRef.current) {
          lastImageRef.current = imgBase64;
          setHistory((prev) => {
            if (prev.length > 0 && prev[0].type === "image" && prev[0].imageData === imgBase64) {
              return prev;
            }
            const imageCount = prev.filter((i) => i.type === "image").length;
            if (imageCount >= MAX_IMAGES) {
              const lastImageIdx = [...prev].reverse().findIndex((i) => i.type === "image");
              if (lastImageIdx >= 0) prev.splice(prev.length - 1 - lastImageIdx, 1);
            }
            const newItem: ClipItem = {
              text: "🖼️ 剪贴板图片",
              id: Date.now(),
              time: Date.now(),
              expanded: false,
              type: "image",
              imageData: imgBase64,
            };
            return [newItem, ...prev].slice(0, MAX_HISTORY);
          });
        }
      } catch {}
    };

    poll();
    const id = window.setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [appWindow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") appWindow.hide();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appWindow]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const handleItemClick = useCallback((id: number) => {
    setHistory((prev) => prev.map((item) => (item.id === id ? { ...item, expanded: !item.expanded } : item)));
    setContextMenu(null);
  }, []);

  const handleCopy = useCallback(async (item: ClipItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (item.type === "text") {
        await writeText(item.text);
        lastTextRef.current = item.text;
      } else if (item.type === "image" && item.imageData) {
        await invoke("write_clipboard_image", { base64Data: item.imageData });
      }
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      setCopiedId(item.id);
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedId(null);
        copyTimerRef.current = null;
      }, 1200);
    } catch {}
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, itemId: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, itemId });
  }, []);

  const deleteItem = useCallback(() => {
    if (contextMenu?.itemId === undefined) return;
    const idToDelete = contextMenu.itemId;
    setHistory((prev) => prev.filter((item) => item.id !== idToDelete));
    setContextMenu(null);
  }, [contextMenu]);

  const toggleItemPin = useCallback((itemId: number) => {
    setHistory((prev) => prev.map((item) => (item.id === itemId ? { ...item, pinned: !item.pinned } : item)));
    setContextMenu(null);
  }, []);

  const togglePin = useCallback(async () => {
    const newPinned = !isPinned;
    setIsPinned(newPinned);
    await appWindow.setAlwaysOnTop(newPinned);
    setContextMenu(null);
  }, [isPinned, appWindow]);

  const hideWindow = useCallback(() => appWindow.hide(), [appWindow]);

  const formatTime = (t: number) => {
    const diff = now - t;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return `${Math.floor(diff / 86400000)}天前`;
  };

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-icon">📋</span>
        <span className="titlebar-text">剪贴板</span>
          <button
            className={`titlebar-btn pin-btn ${isPinned ? "active" : ""}`}
            onClick={togglePin}
            title={isPinned ? "取消置顶" : "置顶窗口"}
          >
            {isPinned ? "📌" : "📍"}
          </button>
          <span className="titlebar-hint">Ctrl+Shift+V</span>
          <button className="titlebar-btn hide-btn" onClick={hideWindow} title="隐藏 (Esc)">
            ➖
          </button>
        </div>

      <div className="clipboard-list" onContextMenu={(e) => e.preventDefault()}>
        {history.length === 0 ? (
          <div className="empty-hint">
            <p>暂无剪贴板记录</p>
            <p className="empty-sub">复制文本或图片后将自动显示在这里</p>
          </div>
        ) : (
          history.map((item) => (
            <div
              key={item.id}
              className={`clipboard-item ${item.expanded ? "expanded" : ""} ${item.pinned ? "pinned" : ""}`}
              onClick={() => handleItemClick(item.id)}
              onContextMenu={(e) => handleContextMenu(e, item.id)}
            >
              {item.pinned && <span className="item-pin-badge">📌</span>}
              <div className="item-text">
                {item.type === "image" && item.imageData ? (
                  <img src={item.imageData} alt="剪贴板图片" className="clipboard-image" />
                ) : (
                  item.text
                )}
              </div>
              <div className="item-time">{formatTime(item.time)}</div>
              <div className="item-actions">
                <span className="action-hint">
                  {item.expanded ? "▲ 折叠" : "▼ 展开"}
                </span>
                {item.type === "text" && (
                  <button
                    className={`copy-btn ${copiedId === item.id ? "copied" : ""}`}
                    onClick={(e) => handleCopy(item, e)}
                  >
                    {copiedId === item.id ? "✓ 已复制" : "复制"}
                  </button>
                )}
                {item.type === "image" && (
                  <button
                    className={`copy-btn ${copiedId === item.id ? "copied" : ""}`}
                    onClick={(e) => handleCopy(item, e)}
                  >
                    {copiedId === item.id ? "✓ 已复制" : "复制"}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={() => toggleItemPin(contextMenu.itemId!)}>
            {history.find((i) => i.id === contextMenu.itemId)?.pinned ? "📌 取消固定" : "📌 固定此项"}
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-item" onClick={togglePin}>
            {isPinned ? "❌ 取消置顶窗口" : "📌 置顶窗口"}
          </div>
          <div className="context-menu-item danger" onClick={deleteItem}>
            🗑️ 删除
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-item" onClick={hideWindow}>
            ➖ 隐藏窗口
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
