# -*- coding: utf-8 -*-
"""继电器连接测试工具 (独立平面版)

非 3D 的桌面小工具, 专用于测试 Modbus TCP 继电器的连接情况与通道开关。
继电器协议逻辑直接复用主系统的 backend/modbus.py, 行为与主程序保持一致。

特性:
- 左侧可保存多台继电器(名称/IP/端口/站号/通道数/每排数量)。
- 每台可单独连接, 已连接的继电器把通道按钮汇总显示在一起。
- 通道为"空气开关/断路器"样式按钮(拨杆上=开/绿, 下=关/灰), 可拖拽排序、右键改名。
- 连接失败给中文原因(超时/被拒绝/网段不通等)。
- 操作日志默认折叠, 点开才显示。
- 排版(顺序+名称)可导出 JSON, 供网页端后续使用。

打包: 在项目根目录执行
    pyinstaller --onefile --windowed --name relay_tester relay_tester.py
产物在 dist/relay_tester.exe, 可独立分发 (已把 backend.modbus 打进 exe)。
"""

import json
import os
import queue
import socket
import sys
import threading
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, simpledialog, ttk

# 让脚本方式运行时也能 import backend (打包后 backend.modbus 已被一并打入 exe)
_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from backend.modbus import ModbusTCP  # noqa: E402  复用主系统的 Modbus TCP 实现


def _data_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


CONFIG_PATH = os.path.join(_data_dir(), "relay_tester_boards.json")
PROJECT_CONFIG = os.path.join(_data_dir(), "dam1600d_devices.json")

DEFAULT_BOARD = {"name": "继电器板", "ip": "192.168.1.100", "port": 502, "unit_id": 254, "channel_count": 32}


def diagnose_connection(ip, port, timeout=3):
    """先做一次裸 TCP 连接, 把失败原因翻译成中文。"""
    try:
        sock = socket.create_connection((ip, int(port)), timeout=timeout)
        sock.close()
        return True, ""
    except socket.timeout:
        return False, "连接超时：设备无响应。请检查 IP 是否正确、本机是否与继电器同一网段、设备是否上电联网。"
    except ConnectionRefusedError:
        return False, "连接被拒绝：端口未开放或已被占用。很多继电器同一时刻只允许一个连接, 请先断开其它软件。"
    except socket.gaierror:
        return False, "地址无效：无法解析该 IP / 主机名。"
    except OSError as error:
        return False, "网络不可达：%s。请检查网线、IP 与网段。" % error
    except Exception as error:  # noqa: BLE001
        return False, str(error)


def normalize_board(board):
    out = dict(DEFAULT_BOARD)
    out["name"] = str(board.get("name") or "继电器板").strip() or "继电器板"
    out["ip"] = str(board.get("ip") or "").strip()
    try:
        out["port"] = int(board.get("port") or 502)
    except (TypeError, ValueError):
        out["port"] = 502
    try:
        out["unit_id"] = int(board.get("unit_id") if board.get("unit_id") is not None else 254)
    except (TypeError, ValueError):
        out["unit_id"] = 254
    try:
        out["channel_count"] = max(1, min(128, int(board.get("channel_count") or 32)))
    except (TypeError, ValueError):
        out["channel_count"] = 32

    count = out["channel_count"]
    order = []
    seen = set()
    raw_order = board.get("order")
    if isinstance(raw_order, list):
        for value in raw_order:
            try:
                channel = int(value)
            except (TypeError, ValueError):
                continue
            if 0 <= channel < count and channel not in seen:
                order.append(channel)
                seen.add(channel)
    for channel in range(count):
        if channel not in seen:
            order.append(channel)
    out["order"] = order

    names = {}
    raw_names = board.get("names")
    if isinstance(raw_names, dict):
        for key, value in raw_names.items():
            try:
                channel = int(key)
            except (TypeError, ValueError):
                continue
            if 0 <= channel < count and isinstance(value, str) and value.strip():
                names[str(channel)] = value.strip()
    out["names"] = names

    try:
        out["columns"] = max(1, min(20, int(board.get("columns") or 12)))
    except (TypeError, ValueError):
        out["columns"] = 12
    return out


def load_boards():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        boards = data.get("boards") if isinstance(data, dict) else None
        if isinstance(boards, list):
            return [normalize_board(b) for b in boards if isinstance(b, dict)]
    except Exception:
        pass
    return []


def save_boards(boards):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "boards": boards}, handle, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def import_project_boards():
    try:
        with open(PROJECT_CONFIG, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        devices = data.get("devices") if isinstance(data, dict) else None
        result = []
        for device in devices or []:
            if not isinstance(device, dict):
                continue
            if device.get("protocol") not in (None, "modbus_tcp"):
                continue
            if not str(device.get("ip") or "").strip():
                continue
            result.append(normalize_board(device))
        return result
    except Exception:
        return []


def board_key(board):
    return "%s:%s" % (board.get("ip", ""), board.get("port", ""))


# ----- 深色仪表盘主题色 -----
BG         = "#0f1115"
SURFACE    = "#1a1d23"
SURFACE_HI = "#222630"
FIELD      = "#13161b"
BORDER     = "#2c313c"
TEXT       = "#e8eaed"
MUTED      = "#8a9099"
ACCENT     = "#30d158"
ACCENT_DK  = "#28b34a"
ACCENT_FG  = "#08240f"

COLOR_IDLE = "#3a3f4b"
COLOR_BUSY = "#e0a93a"
COLOR_OK   = "#30d158"
COLOR_FAIL = "#ff453a"

LIST_OK   = ACCENT
LIST_FAIL = COLOR_FAIL
LIST_BUSY = COLOR_BUSY
LIST_NONE = "#cfd3da"

FONT_UI    = ("Microsoft YaHei UI", 10)
FONT_BOLD  = ("Microsoft YaHei UI", 10, "bold")
FONT_TITLE = ("Microsoft YaHei UI", 14, "bold")
FONT_H2    = ("Microsoft YaHei UI", 11, "bold")
FONT_MONO  = ("Consolas", 9)

AUTO_REFRESH_MS = 2000
# 断路器(空气开关)按钮的格子尺寸 —— 拖拽命中依赖它, 改了要同步
CELL_W = 58
CELL_H = 104
DRAG_THRESHOLD = 6


class RelayTester(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("继电器连接测试工具")
        self.geometry("1040x680")
        self.minsize(900, 560)

        self.boards = load_boards()
        self.selected_index = None
        self.board_status = {}                 # "ip:port" -> {"state","detail"}

        # 已连接的继电器: key -> {"board","states","connected": True}
        self.conns = {}
        # 选中但未连接的继电器: 本地预览状态
        self.preview_key = None
        self.preview_states = []

        self.panel_canvases = {}               # key -> 该板的断路器 Canvas
        self.drag = None
        self.log_open = False

        # worker 线程: 串行处理所有 Modbus IO, 支持多台并存
        self._clients = {}                     # key -> ModbusTCP (worker 持有)
        self._binfo = {}                       # key -> {"unit","count"} (worker 持有, 避免跨线程读 UI 状态)
        self._cmd_q = queue.Queue()
        self._ui_q = queue.Queue()
        self._worker = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker.start()

        self._apply_modern_style()
        self._build_ui()
        self._refresh_board_list()
        if not self.boards:
            self._maybe_offer_import()
        if not self.boards:
            self.boards = [normalize_board(
                {"name": "示例继电器(可编辑/删除)", "ip": "192.168.1.100",
                 "port": 502, "unit_id": 254, "channel_count": 32})]
            save_boards(self.boards)
            self._refresh_board_list()
            self._log("列表为空, 已自动添加一台示例继电器; 选中它并点「连接」即可测试。")

        if self.boards:
            self.selected_index = 0
            self.board_list.selection_clear(0, "end")
            self.board_list.selection_set(0)
            self._on_select_board()

        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(50, self._pump_ui)
        self.after(AUTO_REFRESH_MS, self._auto_tick)

    # ---------- 样式 ----------
    def _apply_modern_style(self):
        self.configure(bg=BG)
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(".", background=SURFACE, foreground=TEXT,
                        fieldbackground=FIELD, bordercolor=BORDER, font=FONT_UI)
        style.configure("TFrame", background=SURFACE)
        style.configure("App.TFrame", background=BG)
        style.configure("AppBar.TFrame", background=BG)
        style.configure("Card.TFrame", background=SURFACE)
        style.configure("Panel.TFrame", background=SURFACE_HI)
        style.configure("TLabel", background=SURFACE, foreground=TEXT, font=FONT_UI)
        style.configure("Card.TLabel", background=SURFACE, foreground=TEXT)
        style.configure("Muted.TLabel", background=SURFACE, foreground=MUTED)
        style.configure("Title.TLabel", background=SURFACE, foreground=TEXT, font=FONT_TITLE)
        style.configure("H2.TLabel", background=SURFACE, foreground=TEXT, font=FONT_H2)
        style.configure("Panel.TLabel", background=SURFACE_HI, foreground=TEXT, font=FONT_H2)
        style.configure("PanelMuted.TLabel", background=SURFACE_HI, foreground=MUTED, font=FONT_UI)
        style.configure("Bar.TLabel", background=BG, foreground=TEXT, font=FONT_H2)
        style.configure("BarMuted.TLabel", background=BG, foreground=MUTED, font=FONT_UI)

        style.configure("TButton", background=SURFACE_HI, foreground=TEXT,
                        bordercolor=BORDER, focuscolor=SURFACE, relief="flat",
                        padding=(12, 7), font=FONT_UI)
        style.map("TButton", background=[("pressed", BORDER), ("active", "#2a2f3a"),
                                         ("disabled", SURFACE)],
                  foreground=[("disabled", MUTED)])
        style.configure("Accent.TButton", background=ACCENT, foreground=ACCENT_FG,
                        bordercolor=ACCENT, focuscolor=ACCENT, relief="flat",
                        padding=(12, 8), font=FONT_BOLD)
        style.map("Accent.TButton", background=[("pressed", ACCENT_DK), ("active", "#3ee066"),
                                                ("disabled", "#2a3530")],
                  foreground=[("disabled", MUTED)])
        style.configure("Small.TButton", background=SURFACE, foreground=TEXT,
                        bordercolor=BORDER, focuscolor=SURFACE_HI, relief="flat",
                        padding=(8, 4), font=FONT_UI)
        style.map("Small.TButton", background=[("active", "#2a2f3a")])
        style.configure("TCheckbutton", background=SURFACE, foreground=TEXT,
                        focuscolor=SURFACE, font=FONT_UI)
        style.map("TCheckbutton", background=[("active", SURFACE)],
                  foreground=[("disabled", MUTED)],
                  indicatorcolor=[("selected", ACCENT), ("!selected", FIELD)])
        style.configure("TEntry", fieldbackground=FIELD, foreground=TEXT,
                        bordercolor=BORDER, insertcolor=TEXT, relief="flat", padding=5)
        style.map("TEntry", bordercolor=[("focus", ACCENT)])
        style.configure("TSeparator", background=BORDER)
        style.configure("Vertical.TScrollbar", background=SURFACE_HI, troughcolor=SURFACE,
                        bordercolor=SURFACE, arrowcolor=MUTED, relief="flat")
        style.map("Vertical.TScrollbar", background=[("active", BORDER)])

    # ---------- 界面 ----------
    def _build_ui(self):
        outer = ttk.Frame(self, style="App.TFrame")
        outer.pack(fill="both", expand=True)

        topbar = ttk.Frame(outer, style="AppBar.TFrame", padding=(14, 10))
        topbar.pack(fill="x")
        ttk.Label(topbar, text="继电器连接测试工具", style="Bar.TLabel").pack(side="left")
        ttk.Label(topbar, text="Modbus TCP · 平面测试台", style="BarMuted.TLabel").pack(side="left", padx=(10, 0))
        ttk.Separator(outer, orient="horizontal").pack(fill="x")

        root = ttk.Frame(outer, style="App.TFrame", padding=12)
        root.pack(fill="both", expand=True)

        # 左: 继电器列表
        left = ttk.Frame(root, style="Card.TFrame", padding=12)
        left.pack(side="left", fill="y")
        ttk.Label(left, text="继电器列表", style="H2.TLabel").pack(anchor="w")
        self.board_list = tk.Listbox(left, width=24, height=16, exportselection=False,
                                     activestyle="none", bg=FIELD, fg=TEXT,
                                     selectbackground=SURFACE_HI, selectforeground=TEXT,
                                     highlightthickness=0, borderwidth=0, font=FONT_UI)
        self.board_list.pack(fill="y", expand=True, pady=(8, 8))
        self.board_list.bind("<<ListboxSelect>>", self._on_select_board)
        crud = ttk.Frame(left, style="Card.TFrame")
        crud.pack(fill="x")
        ttk.Button(crud, text="新增", command=self._add_board, width=6, style="Small.TButton").pack(side="left")
        ttk.Button(crud, text="编辑", command=self._edit_board, width=6, style="Small.TButton").pack(side="left", padx=4)
        ttk.Button(crud, text="删除", command=self._delete_board, width=6, style="Small.TButton").pack(side="left")
        ttk.Button(left, text="⚡ 连接全部", command=self._connect_all, style="Accent.TButton").pack(fill="x", pady=(10, 4))
        ttk.Button(left, text="断开全部", command=self._disconnect_all, style="Small.TButton").pack(fill="x")
        ttk.Button(left, text="导入工程设备", command=self._do_import, style="Small.TButton").pack(fill="x", pady=(10, 0))
        ttk.Button(left, text="导出排版(供网页)", command=self._export_layout, style="Small.TButton").pack(fill="x", pady=(6, 0))

        ttk.Separator(root, orient="vertical").pack(side="left", fill="y", padx=10)

        # 右: 操作区
        right = ttk.Frame(root, style="Card.TFrame", padding=14)
        right.pack(side="left", fill="both", expand=True)

        head = ttk.Frame(right, style="Card.TFrame")
        head.pack(fill="x")
        self._build_status_pill(head)
        self.auto_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(head, text="自动刷新状态(2秒)", variable=self.auto_var).pack(side="right", padx=(0, 4))
        ttk.Button(head, text="全部关闭", command=lambda: self._all_connected(False), style="Small.TButton").pack(side="right", padx=4)
        ttk.Button(head, text="全部打开", command=lambda: self._all_connected(True), style="Small.TButton").pack(side="right", padx=4)

        ttk.Label(right, text="通道开关 (空气开关样式 · 点击=切换/未连接时预览 · 拖拽=排序 · 右键=改名)",
                  style="H2.TLabel").pack(anchor="w", pady=(12, 6))

        # 可滚动的面板区: 每台已连接(或选中预览)的继电器一组断路器
        host = ttk.Frame(right, style="Card.TFrame")
        host.pack(fill="both", expand=True)
        self.panels_scroll = tk.Canvas(host, bg=BG, highlightthickness=0)
        vbar = ttk.Scrollbar(host, orient="vertical", command=self.panels_scroll.yview, style="Vertical.TScrollbar")
        self.panels_scroll.configure(yscrollcommand=vbar.set)
        vbar.pack(side="right", fill="y")
        self.panels_scroll.pack(side="left", fill="both", expand=True)
        self.panels_frame = ttk.Frame(self.panels_scroll, style="App.TFrame")
        self._panels_window = self.panels_scroll.create_window((0, 0), window=self.panels_frame, anchor="nw")
        self.panels_frame.bind("<Configure>",
                               lambda e: self.panels_scroll.configure(scrollregion=self.panels_scroll.bbox("all")))
        self.panels_scroll.bind("<Configure>",
                                lambda e: self.panels_scroll.itemconfigure(self._panels_window, width=e.width))
        self.panels_scroll.bind_all("<MouseWheel>", self._on_mousewheel)

        # 折叠的操作日志
        self.log_toggle = ttk.Button(right, text="▸ 操作日志", command=self._toggle_log, style="Small.TButton")
        self.log_toggle.pack(anchor="w", pady=(8, 0))
        self.log_wrap = ttk.Frame(right, style="Card.TFrame")
        self.log = tk.Text(self.log_wrap, height=7, state="disabled", wrap="word", font=FONT_MONO,
                           bg=FIELD, fg=MUTED, insertbackground=TEXT, relief="flat",
                           borderwidth=0, highlightthickness=0, padx=10, pady=8)
        log_scroll = ttk.Scrollbar(self.log_wrap, command=self.log.yview, style="Vertical.TScrollbar")
        self.log.configure(yscrollcommand=log_scroll.set)
        self.log.pack(side="left", fill="both", expand=True)
        log_scroll.pack(side="right", fill="y")
        # 默认折叠(不 pack log_wrap)

    def _build_status_pill(self, parent):
        shell = tk.Frame(parent, bg=SURFACE)
        shell.pack(side="left")
        pill = tk.Frame(shell, bg=COLOR_IDLE)
        pill.pack(ipady=2)
        self.status_dot = tk.Canvas(pill, width=14, height=14, bg=COLOR_IDLE, highlightthickness=0)
        self.status_dot.pack(side="left", padx=(14, 8), pady=10)
        self._draw_status_dot(COLOR_IDLE)
        self.status_label = tk.Label(pill, text="未连接", bg=COLOR_IDLE, fg="#ffffff", font=FONT_H2, anchor="w")
        self.status_label.pack(side="left", padx=(0, 16), pady=8)
        self._status_pill = pill

    def _draw_status_dot(self, color):
        self.status_dot.delete("all")
        self.status_dot.configure(bg=color)
        self.status_dot.create_oval(2, 2, 12, 12, fill="#ffffff", outline="")

    def _set_status(self, color, text):
        self.status_label.config(bg=color, text=text)
        if getattr(self, "_status_pill", None) is not None:
            self._status_pill.config(bg=color)
        if getattr(self, "status_dot", None) is not None:
            self._draw_status_dot(color)

    def _refresh_status_summary(self):
        n = len(self.conns)
        if n == 0:
            self._set_status(COLOR_IDLE, "未连接")
            return
        total_ch = sum(len(c["board"]["order"]) for c in self.conns.values())
        self._set_status(COLOR_OK, "已连接 %d 台 · 共 %d 路通道" % (n, total_ch))

    def _on_mousewheel(self, event):
        try:
            self.panels_scroll.yview_scroll(int(-event.delta / 120), "units")
        except Exception:
            pass

    def _toggle_log(self):
        self.log_open = not self.log_open
        if self.log_open:
            self.log_wrap.pack(fill="both", expand=False, pady=(6, 0))
            self.log_toggle.config(text="▾ 操作日志")
        else:
            self.log_wrap.pack_forget()
            self.log_toggle.config(text="▸ 操作日志")

    # ---------- 继电器列表 ----------
    def _refresh_board_list(self):
        self.board_list.delete(0, "end")
        glyphs = {"ok": "● ", "fail": "✗ ", "busy": "… "}
        colors = {"ok": LIST_OK, "fail": LIST_FAIL, "busy": LIST_BUSY}
        for index, board in enumerate(self.boards):
            key = board_key(board)
            if key in self.conns:
                glyph, color = "● ", LIST_OK
            else:
                st = self.board_status.get(key)
                glyph = glyphs.get(st["state"], "○ ") if st else "○ "
                color = colors.get(st["state"]) if st else None
            self.board_list.insert("end", "%s%s  —  %s:%d" % (glyph, board["name"], board["ip"], board["port"]))
            self.board_list.itemconfig(index, foreground=color or LIST_NONE)
        if self.selected_index is not None and 0 <= self.selected_index < len(self.boards):
            self.board_list.selection_set(self.selected_index)

    def _on_select_board(self, _event=None):
        sel = self.board_list.curselection()
        if not sel:
            return
        self.selected_index = sel[0]
        board = self.boards[self.selected_index]
        key = board_key(board)
        # 选中未连接的板 -> 准备本地预览
        if key not in self.conns:
            self.preview_key = key
            self.preview_states = [False] * board["channel_count"]
        else:
            self.preview_key = None
        self._refresh_panels()

    def _current_board(self):
        if self.selected_index is None or not (0 <= self.selected_index < len(self.boards)):
            return None
        return self.boards[self.selected_index]

    def _board_by_key(self, key):
        for board in self.boards:
            if board_key(board) == key:
                return board
        return None

    def _add_board(self):
        board = self._board_dialog("新增继电器", dict(DEFAULT_BOARD))
        if not board:
            return
        if any(board_key(b) == board_key(board) for b in self.boards):
            messagebox.showwarning("提示", "已存在相同 IP:端口 的继电器, 请使用不同地址。", parent=self)
            return
        self.boards.append(board)
        self.selected_index = len(self.boards) - 1
        save_boards(self.boards)
        self._refresh_board_list()
        self._on_select_board()

    def _edit_board(self):
        board = self._current_board()
        if not board:
            messagebox.showinfo("提示", "请先在左侧选择一台继电器。", parent=self)
            return
        old_key = board_key(board)
        was_connected = old_key in self.conns
        edited = self._board_dialog("编辑继电器", dict(board))
        if not edited:
            return
        new_key = board_key(edited)
        for i, other in enumerate(self.boards):
            if i != self.selected_index and board_key(other) == new_key:
                messagebox.showwarning("提示", "已存在相同 IP:端口 的继电器, 请使用不同地址。", parent=self)
                return
        if was_connected:
            self._cmd_q.put(("disconnect", old_key))
        self.boards[self.selected_index] = edited
        save_boards(self.boards)
        self._refresh_board_list()
        self._on_select_board()
        # 改完自动重连(同址=重连; 改址=连新地址), 不让编辑悄悄丢掉连接
        if was_connected:
            self._connect_one(edited)

    def _delete_board(self):
        board = self._current_board()
        if not board:
            return
        if not messagebox.askyesno("确认", "删除继电器「%s」？" % board["name"], parent=self):
            return
        if board_key(board) in self.conns:
            self._cmd_q.put(("disconnect", board_key(board)))
        del self.boards[self.selected_index]
        self.selected_index = None
        self.preview_key = None
        save_boards(self.boards)
        self._refresh_board_list()
        self._refresh_panels()

    def _do_import(self):
        imported = import_project_boards()
        if not imported:
            messagebox.showinfo("导入工程设备",
                                "未找到可导入的设备。\n请把本工具与 dam1600d_devices.json 放在同一目录后再试。", parent=self)
            return
        existing = {board_key(b) for b in self.boards}
        added = 0
        for board in imported:
            if board_key(board) not in existing:
                self.boards.append(board)
                existing.add(board_key(board))
                added += 1
        save_boards(self.boards)
        self._refresh_board_list()
        messagebox.showinfo("导入工程设备", "已导入 %d 台继电器(已跳过重复)。" % added, parent=self)

    def _maybe_offer_import(self):
        if os.path.exists(PROJECT_CONFIG) and import_project_boards():
            if messagebox.askyesno("导入工程设备",
                                   "检测到同目录下的工程文件 dam1600d_devices.json。\n是否导入其中的继电器作为测试列表？", parent=self):
                self._do_import()

    def _board_dialog(self, title, board):
        dialog = tk.Toplevel(self)
        dialog.title(title)
        dialog.configure(bg=SURFACE)
        dialog.transient(self)
        dialog.resizable(False, False)
        dialog.grab_set()
        result = {}
        fields = [
            ("名称", "name", str(board.get("name", ""))),
            ("IP 地址", "ip", str(board.get("ip", ""))),
            ("端口", "port", str(board.get("port", 502))),
            ("站号", "unit_id", str(board.get("unit_id", 254))),
            ("通道数 (1-128)", "channel_count", str(board.get("channel_count", 32))),
            ("每排数量 (1-20)", "columns", str(board.get("columns", 12))),
        ]
        entries = {}
        frame = ttk.Frame(dialog, style="Card.TFrame", padding=14)
        frame.pack(fill="both", expand=True)
        for row, (label, key, value) in enumerate(fields):
            ttk.Label(frame, text=label, width=14, anchor="w", style="Card.TLabel").grid(row=row, column=0, sticky="w", pady=4)
            entry = ttk.Entry(frame, width=26)
            entry.insert(0, value)
            entry.grid(row=row, column=1, pady=4)
            entries[key] = entry

        def on_ok():
            candidate = dict(board)
            for key in entries:
                candidate[key] = entries[key].get()
            if not str(candidate.get("ip") or "").strip():
                messagebox.showwarning("提示", "请填写 IP 地址。", parent=dialog)
                return
            result.update(normalize_board(candidate))
            dialog.destroy()

        btn_row = ttk.Frame(frame, style="Card.TFrame")
        btn_row.grid(row=len(fields), column=0, columnspan=2, pady=(10, 0))
        ttk.Button(btn_row, text="取消", command=dialog.destroy, width=10, style="Small.TButton").pack(side="right", padx=4)
        ttk.Button(btn_row, text="确定", command=on_ok, width=10, style="Accent.TButton").pack(side="right")
        entries["name"].focus_set()
        self.wait_window(dialog)
        return result if result else None

    # ---------- 汇总面板 (每台一组断路器) ----------
    def _visible_keys(self):
        """要显示面板的板: 所有已连接的 + 选中但未连接的(预览)。"""
        keys = []
        for board in self.boards:
            key = board_key(board)
            if key in self.conns:
                keys.append(key)
        sel = self._current_board()
        if sel and board_key(sel) not in self.conns:
            keys.append(board_key(sel))
        return keys

    def _states_for(self, key):
        if key in self.conns:
            return self.conns[key]["states"]
        if key == self.preview_key:
            return self.preview_states
        return []

    def _refresh_panels(self):
        for child in self.panels_frame.winfo_children():
            child.destroy()
        self.panel_canvases = {}
        keys = self._visible_keys()
        if not keys:
            ttk.Label(self.panels_frame, text="选中左侧继电器并点「连接」, 已连接的继电器会把通道汇总显示在这里。",
                      style="BarMuted.TLabel").pack(anchor="w", padx=4, pady=16)
            self._refresh_status_summary()
            return
        for key in keys:
            self._build_board_panel(key)
        self._refresh_status_summary()

    def _build_board_panel(self, key):
        board = self._board_by_key(key)
        if not board:
            return
        connected = key in self.conns
        panel = ttk.Frame(self.panels_frame, style="Panel.TFrame", padding=10)
        panel.pack(fill="x", pady=(0, 10))

        header = ttk.Frame(panel, style="Panel.TFrame")
        header.pack(fill="x")
        tag = "● 已连通" if connected else "○ 未连接 · 预览"
        ttk.Label(header, text="%s  (%s:%d)" % (board["name"], board["ip"], board["port"]),
                  style="Panel.TLabel").pack(side="left")
        ttk.Label(header, text="   " + tag, style="PanelMuted.TLabel").pack(side="left")
        if connected:
            ttk.Button(header, text="断开", style="Small.TButton",
                       command=lambda k=key: self._cmd_q.put(("disconnect", k))).pack(side="right")
            ttk.Button(header, text="全关", style="Small.TButton",
                       command=lambda k=key: self._cmd_q.put(("all_one", k, False))).pack(side="right", padx=4)
            ttk.Button(header, text="全开", style="Small.TButton",
                       command=lambda k=key: self._cmd_q.put(("all_one", k, True))).pack(side="right", padx=4)
        else:
            ttk.Button(header, text="连接", style="Accent.TButton",
                       command=lambda b=dict(board): self._connect_one(b)).pack(side="right")

        cols = board["columns"]
        order = board["order"]
        rows = max(1, (len(order) + cols - 1) // cols)
        canvas = tk.Canvas(panel, width=cols * CELL_W, height=rows * CELL_H,
                           bg=FIELD, highlightthickness=0)
        canvas.pack(anchor="w", pady=(8, 0))
        canvas.board_key = key
        canvas.bind("<Button-1>", lambda e, k=key: self._on_grid_press(e, k))
        canvas.bind("<B1-Motion>", lambda e, k=key: self._on_grid_motion(e, k))
        canvas.bind("<ButtonRelease-1>", lambda e, k=key: self._on_grid_release(e, k))
        canvas.bind("<Button-3>", lambda e, k=key: self._on_grid_rightclick(e, k))
        self.panel_canvases[key] = canvas
        self._redraw_board(key)

    # ---------- 断路器(空气开关)绘制 ----------
    def _draw_breaker(self, canvas, x, y, channel, on, name):
        cx = x + CELL_W // 2
        # 模块外壳(浅色, 像真的断路器)
        canvas.create_rectangle(x + 5, y + 3, x + CELL_W - 5, y + 84,
                                fill="#dfe3ea", outline="#9aa0ab", width=1)
        # 拨杆凹槽
        canvas.create_rectangle(cx - 12, y + 12, cx + 12, y + 54, fill="#11141a", outline="#0a0c10")
        # 拨杆: 开=上(绿), 关=下(灰)
        if on:
            canvas.create_rectangle(cx - 9, y + 15, cx + 9, y + 31, fill=ACCENT, outline="#1f7a36")
            state_txt, state_col = "开", ACCENT
        else:
            canvas.create_rectangle(cx - 9, y + 35, cx + 9, y + 51, fill="#5b626e", outline="#3a3f4b")
            state_txt, state_col = "关", "#7c8390"
        canvas.create_text(cx, y + 66, text=state_txt, font=("Microsoft YaHei UI", 9, "bold"), fill=state_col)
        # 通道号
        canvas.create_text(cx, y + 77, text="通道%02d" % (channel + 1),
                           font=("Microsoft YaHei UI", 7), fill="#3a3f4b")
        # 自定义名称(壳下方, 强调绿)
        if name:
            canvas.create_text(cx, y + 95, text=name[:4], font=("Microsoft YaHei UI", 8), fill=ACCENT)

    def _redraw_board(self, key, drag_pos=None, drag_xy=None):
        canvas = self.panel_canvases.get(key)
        board = self._board_by_key(key)
        if canvas is None or board is None:
            return
        canvas.delete("all")
        order = board["order"]
        names = board["names"]
        states = self._states_for(key)
        cols = board["columns"]
        for pos, channel in enumerate(order):
            if drag_pos is not None and pos == drag_pos:
                continue
            x = (pos % cols) * CELL_W
            y = (pos // cols) * CELL_H
            on = channel < len(states) and bool(states[channel])
            self._draw_breaker(canvas, x, y, channel, on, names.get(str(channel)))
        if drag_pos is not None and drag_xy is not None:
            target = self._pos_at(key, drag_xy[0], drag_xy[1])
            if target is None:
                target = len(order) - 1
            tx = (target % cols) * CELL_W
            ty = (target // cols) * CELL_H
            canvas.create_rectangle(tx + 2, ty + 2, tx + CELL_W - 2, ty + CELL_H - 2,
                                    outline=ACCENT, dash=(3, 2))
            ch = order[drag_pos]
            on = ch < len(states) and bool(states[ch])
            self._draw_breaker(canvas, drag_xy[0] - CELL_W // 2, drag_xy[1] - CELL_H // 2,
                               ch, on, names.get(str(ch)))

    def _pos_at(self, key, x, y):
        board = self._board_by_key(key)
        if not board:
            return None
        cols = board["columns"]
        col = int(x // CELL_W)
        row = int(y // CELL_H)
        if col < 0 or col >= cols or row < 0:
            return None
        pos = row * cols + col
        if 0 <= pos < len(board["order"]):
            return pos
        return None

    def _on_grid_press(self, event, key):
        pos = self._pos_at(key, event.x, event.y)
        if pos is None:
            self.drag = None
            return
        self.drag = {"key": key, "from": pos, "sx": event.x, "sy": event.y, "moved": False}

    def _on_grid_motion(self, event, key):
        if not self.drag or self.drag["key"] != key:
            return
        if not self.drag["moved"]:
            if abs(event.x - self.drag["sx"]) > DRAG_THRESHOLD or abs(event.y - self.drag["sy"]) > DRAG_THRESHOLD:
                self.drag["moved"] = True
        if self.drag["moved"]:
            self._redraw_board(key, drag_pos=self.drag["from"], drag_xy=(event.x, event.y))

    def _on_grid_release(self, event, key):
        if not self.drag or self.drag["key"] != key:
            return
        drag = self.drag
        self.drag = None
        board = self._board_by_key(key)
        if not board:
            return
        if not drag["moved"]:
            self._click_channel(key, board["order"][drag["from"]])
            return
        target = self._pos_at(key, event.x, event.y)
        if target is None:
            target = len(board["order"]) - 1
        ch = board["order"].pop(drag["from"])
        target = max(0, min(len(board["order"]), target))
        board["order"].insert(target, ch)
        save_boards(self.boards)
        self._redraw_board(key)

    def _click_channel(self, key, channel):
        if key in self.conns:
            states = self.conns[key]["states"]
            value = not (channel < len(states) and bool(states[channel]))
            self._cmd_q.put(("toggle", key, channel, value))
            return
        # 未连接: 本地预览
        if key == self.preview_key:
            if len(self.preview_states) <= channel:
                self.preview_states = (self.preview_states + [False] * (channel + 1))[:channel + 1]
            self.preview_states[channel] = not bool(self.preview_states[channel])
            self._redraw_board(key)

    def _on_grid_rightclick(self, event, key):
        pos = self._pos_at(key, event.x, event.y)
        board = self._board_by_key(key)
        if pos is None or not board:
            return
        channel = board["order"][pos]
        menu = tk.Menu(self, tearoff=0, bg=SURFACE, fg=TEXT,
                       activebackground=SURFACE_HI, activeforeground=TEXT, bd=0)
        menu.add_command(label="通道%02d 重命名…" % (channel + 1),
                         command=lambda: self._rename_channel(key, channel))
        if board["names"].get(str(channel)):
            menu.add_command(label="清除名称", command=lambda: self._clear_channel_name(key, channel))
        menu.add_separator()
        menu.add_command(label="移到最前", command=lambda p=pos: self._move_to(key, p, 0))
        menu.add_command(label="移到最后", command=lambda p=pos: self._move_to(key, p, len(board["order"]) - 1))
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _rename_channel(self, key, channel):
        board = self._board_by_key(key)
        if not board:
            return
        current = board["names"].get(str(channel), "")
        value = simpledialog.askstring("重命名通道", "通道%02d 的名称：" % (channel + 1),
                                       initialvalue=current, parent=self)
        if value is None:
            return
        value = value.strip()
        if value:
            board["names"][str(channel)] = value
        else:
            board["names"].pop(str(channel), None)
        save_boards(self.boards)
        self._redraw_board(key)

    def _clear_channel_name(self, key, channel):
        board = self._board_by_key(key)
        if board:
            board["names"].pop(str(channel), None)
            save_boards(self.boards)
            self._redraw_board(key)

    def _move_to(self, key, from_pos, to_pos):
        board = self._board_by_key(key)
        if not board or not (0 <= from_pos < len(board["order"])):
            return
        ch = board["order"].pop(from_pos)
        to_pos = max(0, min(len(board["order"]), to_pos))
        board["order"].insert(to_pos, ch)
        save_boards(self.boards)
        self._redraw_board(key)

    # ---------- 连接动作 ----------
    def _connect_one(self, board):
        self._cmd_q.put(("connect", dict(board)))

    def _connect(self):
        board = self._current_board()
        if board:
            self._connect_one(board)

    def _connect_all(self):
        if not self.boards:
            return
        pending = [b for b in self.boards if board_key(b) not in self.conns]
        if not pending:
            self._log("全部继电器都已连接。")
            return
        self._log("开始连接 %d 台继电器…" % len(pending))
        for board in pending:
            self._cmd_q.put(("connect", dict(board)))

    def _disconnect_all(self):
        for key in list(self.conns.keys()):
            self._cmd_q.put(("disconnect", key))

    def _all_connected(self, value):
        for key in list(self.conns.keys()):
            self._cmd_q.put(("all_one", key, bool(value)))

    def _refresh_states(self):
        for key in list(self.conns.keys()):
            self._cmd_q.put(("read", key, False))

    def _auto_tick(self):
        if self.auto_var.get():
            for key in list(self.conns.keys()):
                self._cmd_q.put(("read", key, True))
        self.after(AUTO_REFRESH_MS, self._auto_tick)

    # ---------- worker 线程 (多客户端) ----------
    def _worker_loop(self):
        while True:
            cmd = self._cmd_q.get()
            if cmd is None:
                for client in list(self._clients.values()):
                    try:
                        client.close()
                    except Exception:
                        pass
                self._clients.clear()
                break
            try:
                self._handle(cmd)
            except Exception as error:  # noqa: BLE001
                self._log_async("内部错误：%s" % error)

    def _handle(self, cmd):
        kind = cmd[0]
        if kind == "connect":
            self._do_connect(cmd[1])
        elif kind == "disconnect":
            self._do_disconnect(cmd[1])
        elif kind == "toggle":
            self._do_toggle(cmd[1], cmd[2], cmd[3])
        elif kind == "all_one":
            self._do_all_one(cmd[1], cmd[2])
        elif kind == "read":
            self._do_read(cmd[1], silent=bool(cmd[2]))

    def _close_key(self, key):
        self._binfo.pop(key, None)
        client = self._clients.pop(key, None)
        if client:
            try:
                client.close()
            except Exception:
                pass

    def _do_connect(self, board):
        ip = board["ip"]
        port = int(board["port"])
        unit = int(board["unit_id"])
        count = int(board["channel_count"])
        key = "%s:%s" % (ip, port)
        # 已连接的板不再拆掉重连, 只刷新一次状态(避免重复点"连接全部"断开健康连接)
        if key in self._clients:
            try:
                states = self._clients[key].read_coils(unit, 0, count)
                self._binfo[key] = {"unit": unit, "count": count}
                self._ui(lambda k=key, b=dict(board), s=list(states): self._on_connected(k, b, s))
                return
            except Exception:
                self._close_key(key)   # 旧连接已坏, 走下面的重连
        self._ui(lambda k=key: self._mark_board(k, "busy", "连接中…"))
        self._close_key(key)

        ok, reason = diagnose_connection(ip, port)
        if not ok:
            self._log_async("✗ %s (%s:%d) — %s" % (board["name"], ip, port, reason))
            self._ui(lambda k=key, r=reason: self._mark_board(k, "fail", r))
            return
        client = ModbusTCP()
        if not client.connect(ip, port):
            self._log_async("✗ %s (%s:%d) — TCP 握手未成功" % (board["name"], ip, port))
            self._ui(lambda k=key: self._mark_board(k, "fail", "TCP 握手未成功"))
            return
        states = []
        try:
            states = client.read_coils(unit, 0, count)
        except Exception as error:  # noqa: BLE001
            self._close_key(key)
            self._log_async("✗ %s — 已连接但读取失败：%s" % (board["name"], error))
            self._ui(lambda k=key, e=error: self._mark_board(k, "fail", "Modbus 无响应(%s)" % e))
            return
        self._clients[key] = client
        self._binfo[key] = {"unit": unit, "count": count}
        self._log_async("✓ %s (%s:%d) — 已连接, 读到 %d 路" % (board["name"], ip, port, len(states)))
        self._ui(lambda k=key, b=dict(board), s=list(states): self._on_connected(k, b, s))

    def _do_disconnect(self, key):
        self._close_key(key)
        self._log_async("已断开 %s" % key)
        self._ui(lambda k=key: self._on_disconnected(k))

    def _do_toggle(self, key, channel, value):
        client = self._clients.get(key)
        if not client:
            return
        try:
            client.write_single_coil(self._unit_of(key), channel, value)
            states = client.read_coils(self._unit_of(key), 0, self._count_of(key))
            self._ui(lambda k=key, s=list(states): self._update_states(k, s))
        except Exception as error:  # noqa: BLE001
            self._log_async("通道%02d 操作失败：%s" % (channel + 1, error))
            self._close_key(key)
            self._ui(lambda k=key, e=error: self._on_lost(k, str(e)))

    def _do_all_one(self, key, value):
        client = self._clients.get(key)
        if not client:
            return
        try:
            client.write_multiple_coils(self._unit_of(key), 0, [value] * self._count_of(key))
            states = client.read_coils(self._unit_of(key), 0, self._count_of(key))
            self._ui(lambda k=key, s=list(states): self._update_states(k, s))
        except Exception as error:  # noqa: BLE001
            self._log_async("批量操作失败：%s" % error)
            self._close_key(key)
            self._ui(lambda k=key, e=error: self._on_lost(k, str(e)))

    def _do_read(self, key, silent=False):
        client = self._clients.get(key)
        if not client:
            return
        try:
            states = client.read_coils(self._unit_of(key), 0, self._count_of(key))
            self._ui(lambda k=key, s=list(states): self._update_states(k, s))
        except Exception as error:  # noqa: BLE001
            if not silent:
                self._log_async("读取状态失败：%s" % error)
            self._close_key(key)
            self._ui(lambda k=key, e=error: self._on_lost(k, str(e)))

    # worker 侧从自己持有的 _binfo 取 unit/count, 不跨线程读 UI 状态
    def _unit_of(self, key):
        info = self._binfo.get(key)
        return info["unit"] if info else 254

    def _count_of(self, key):
        info = self._binfo.get(key)
        return info["count"] if info else 32

    # ---------- UI 回调 ----------
    def _ui(self, fn):
        self._ui_q.put(fn)

    def _log_async(self, message):
        self._ui(lambda: self._log(message))

    def _pump_ui(self):
        try:
            while True:
                fn = self._ui_q.get_nowait()
                try:
                    fn()
                except Exception:
                    pass
        except queue.Empty:
            pass
        self.after(50, self._pump_ui)

    def _log(self, message):
        self.log.config(state="normal")
        self.log.insert("end", "[%s] %s\n" % (datetime.now().strftime("%H:%M:%S"), message))
        self.log.see("end")
        self.log.config(state="disabled")

    def _mark_board(self, key, state, detail):
        self.board_status[key] = {"state": state, "detail": detail}
        self._refresh_board_list()
        if state == "busy":
            self._set_status(COLOR_BUSY, "连接中…")
        elif state == "fail":
            self._set_status(COLOR_FAIL, "连接失败：" + detail)

    def _on_connected(self, key, board, states):
        self.conns[key] = {"board": board, "states": list(states), "connected": True}
        self.board_status[key] = {"state": "ok", "detail": "已连通"}
        if key == self.preview_key:
            self.preview_key = None
        self._refresh_board_list()
        self._refresh_panels()

    def _on_disconnected(self, key):
        self.conns.pop(key, None)
        self.board_status.pop(key, None)
        sel = self._current_board()
        if sel and board_key(sel) == key:
            self.preview_key = key
            self.preview_states = [False] * sel["channel_count"]
        self._refresh_board_list()
        self._refresh_panels()

    def _on_lost(self, key, reason):
        self.conns.pop(key, None)
        self.board_status[key] = {"state": "fail", "detail": reason}
        self._set_status(COLOR_FAIL, "连接已断开：" + reason)
        self._refresh_board_list()
        self._refresh_panels()

    def _update_states(self, key, states):
        if key in self.conns:
            self.conns[key]["states"] = list(states)
            self._redraw_board(key)

    # ---------- 导出排版 ----------
    def _export_layout(self):
        if not self.boards:
            messagebox.showinfo("导出排版", "还没有继电器, 请先新增或导入。", parent=self)
            return
        path = filedialog.asksaveasfilename(parent=self, title="导出排版 (供网页使用)",
                                            defaultextension=".json", initialfile="relay_layout.json",
                                            filetypes=[("JSON 文件", "*.json"), ("所有文件", "*.*")])
        if not path:
            return
        layout = {"version": 1, "type": "relay_layout", "boards": []}
        for board in self.boards:
            norm = normalize_board(board)
            channels = [{"order": i + 1, "channel": ch, "name": norm["names"].get(str(ch), "")}
                        for i, ch in enumerate(norm["order"])]
            layout["boards"].append({
                "name": norm["name"], "ip": norm["ip"], "port": norm["port"],
                "unit_id": norm["unit_id"], "channel_count": norm["channel_count"],
                "columns": norm["columns"], "channels": channels,
            })
        try:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(layout, handle, ensure_ascii=False, indent=2)
            self._log("已导出排版到 %s" % path)
            messagebox.showinfo("导出排版", "排版已导出：\n%s\n\n该文件供网页端后续导入使用。" % path, parent=self)
        except Exception as error:  # noqa: BLE001
            messagebox.showerror("导出失败", str(error), parent=self)

    def _on_close(self):
        try:
            self._cmd_q.put(None)
        except Exception:
            pass
        self.destroy()


def main():
    app = RelayTester()
    app.mainloop()


if __name__ == "__main__":
    main()
