# -*- coding: utf-8 -*-
"""生成 NSIS 安装器/卸载器品牌侧板:installerSidebar.bmp / uninstallerSidebar.bmp。

electron-builder 的 assisted 向导(nsis.oneClick:false)在欢迎/完成/卸载页左侧留
164×314 的位图位,缺省是白底图标占位——与壳内新更新窗(desktop/update-window.html,
直抄 globals.css 设计 token)的产品设计语言脱节。本脚本按同一套 token 生成同语言
侧板:米白底 + 应用图标同款橙渐变圆角块 + 字标 + 特性清单 + 底部品牌条。

约束:必须 24 位 BMP(MUI2 不认带 alpha 的位图),尺寸固定 164×314。
只影响首装/卸载两屏的观感,不触碰任何 NSIS 脚本逻辑(installer.nsh 不动)。
用法:python make_installer_art.py   (需要 Pillow,同 make_icon.py)
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

HERE = Path(__file__).parent
W, H = 164, 314

# update-window.html 直抄的 globals.css token(浅色)
BG        = (253, 250, 246)   # --bg #FDFAF6
TEXT      = (10, 10, 10)      # --text-main #0a0a0a
MUTED     = (107, 114, 128)   # --text-muted #6B7280
FAINT     = (156, 163, 175)   # --text-muted 的 dark 值,底注更退一档
BRAND_500 = (229, 106, 74)    # --brand-500 #E56A4A
BRAND_700 = (166, 64, 39)     # --brand-700 #A64027
SUCCESS   = (16, 185, 129)    # --success #10B981
# logo 块沿用应用图标同款橙渐变(make_icon.py 的 ORANGE_TOP/BOTTOM)
ORANGE_TOP = (240, 138, 46)   # #F08A2E
ORANGE_BOT = (226, 98, 14)    # #E2620E

FEATURES = ["40+ 供应商统一路由", "OpenAI 兼容 /v1 端点", "凭据·配额·用量面板"]


def _font(names, size):
    for name in names:
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except OSError:
            continue
    return ImageFont.load_default()


def _bold(size):
    return _font(("segoeuib.ttf", "arialbd.ttf", "arial.ttf"), size)


def _ui(size):
    return _font(("segoeui.ttf", "arial.ttf"), size)


def _cjk(size):
    return _font(("msyh.ttc", "msyhbd.ttc", "simhei.ttf"), size)


def _lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def _blend(base, over, alpha):
    return _lerp(base, over, alpha)


def build():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # 顶部品牌洗染:brand 10% → 0,纵向 120px 线性淡出(无 alpha 通道,逐行混色)
    for y in range(120):
        d.line([(0, y), (W, y)], fill=_blend(BG, BRAND_500, 0.10 * (1 - y / 120)))

    # 应用图标同语言:橙渐变圆角块 + 白色粗体 "10"(半径比 0.24 同 make_icon.py)
    tile = 46
    tx, ty = 16, 22
    grad = Image.new("RGB", (tile, tile), ORANGE_TOP)
    gd = ImageDraw.Draw(grad)
    for y in range(tile):
        gd.line([(0, y), (tile, y)], fill=_lerp(ORANGE_TOP, ORANGE_BOT, y / (tile - 1)))
    mask = Image.new("L", (tile, tile), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, tile - 1, tile - 1], radius=int(tile * 0.24), fill=255
    )
    img.paste(grad, (tx, ty), mask)
    f10 = _bold(int(tile * 0.44))
    bbox = d.textbbox((0, 0), "10", font=f10)
    d.text(
        (tx + (tile - (bbox[2] - bbox[0])) / 2 - bbox[0],
         ty + (tile - (bbox[3] - bbox[1])) / 2 - bbox[1]),
        "10", font=f10, fill=(255, 255, 255),
    )

    # 字标 + 副题
    y = ty + tile + 14
    d.text((tx, y), "10Router", font=_bold(17), fill=TEXT)
    y += 26
    d.text((tx + 1, y), "本地 AI 路由网关", font=_cjk(9), fill=MUTED)

    # 特性清单:success 16% 圆底 + 对勾,文案深色
    y += 28
    for label in FEATURES:
        r = 7
        cx, cy = tx + r, y + r + 1
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=_blend(BG, SUCCESS, 0.16))
        d.line([(cx - 3, cy), (cx - 1, cy + 3), (cx + 3, cy - 3)], fill=SUCCESS, width=2)
        d.text((tx + 2 * r + 7, y), label, font=_cjk(9), fill=TEXT)
        y += 22

    # 底注 + 底部品牌条(brand-500 → brand-700 横向渐变,3px)
    d.text((tx, H - 26), "github.com/techysy/10router", font=_ui(8), fill=FAINT)
    for x in range(W):
        d.line([(x, H - 3), (x, H)], fill=_lerp(BRAND_500, BRAND_700, x / (W - 1)))

    return img


if __name__ == "__main__":
    art = build().convert("RGB")   # 24 位,无 alpha —— MUI2 的硬约束
    art.save(HERE / "installerSidebar.bmp")
    art.save(HERE / "uninstallerSidebar.bmp")
    art.save(HERE / "installerSidebar-preview.png")   # 目检用,不入 build.files
    print("written: installerSidebar.bmp / uninstallerSidebar.bmp (164x314, 24-bit)")
