"""(주)오름 픽셀 오피스 스프라이트 생성기. 전부 이 스크립트가 직접 찍는다 (외부 그림 에셋 없음).

실행:  python tools/make_sprites.py          (web/ 에서. Pillow 필요)
출력:  public/assets/oreum/room.png    320x208  배경 (카펫·벽·창틀·복합기·파티션·회의 테이블). 창 유리는 투명
       public/assets/oreum/chars.png   24x30 x 10칸  캐릭터 5명 x (기본, 눈 감음)
       public/assets/oreum/desk.png    48x24  책상
       public/assets/oreum/chair.png   16x18  의자
       public/assets/oreum/monitor.png 14x14 x 3칸  모니터 (꺼짐, 켜짐 A, 켜짐 B)
       public/assets/oreum/icons.png   12x12 x 6칸  사이드바 아이콘 (업무, 오디, 자료, 팀원, 제출, 나가기)
       public/assets/oreum/preview.png, preview_chars.png  확인용 (앱에서는 안 씀)

창 유리를 투명하게 두는 이유: scene.ts 가 그 뒤에 하늘색을 깔고 게임 시간에 따라 바꾼다.
"""
import os
import random
from PIL import Image, ImageDraw

W, H = 320, 208
WALL_H = 38
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "oreum")
SEATS = {"kang": (3, 3), "jung": (10, 3), "park": (16, 3), "lee": (6, 9), "me": (13, 9)}
WINDOWS_X = (58, 140, 222)


def c(hexs, a=255):
    hexs = hexs.lstrip("#")
    return (int(hexs[0:2], 16), int(hexs[2:4], 16), int(hexs[4:6], 16), a)


def rect(d, x, y, w, h, col):
    if w > 0 and h > 0:
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=col)


def over(img, x, y, w, h, col):
    """반투명 덧칠 (그림자)"""
    img.alpha_composite(Image.new("RGBA", (w, h), col), (x, y))


def shade(col, dv):
    return tuple(max(0, min(255, v + dv)) for v in col[:3]) + (255,)


OUTLINE = c("#4a3a30")
METAL_D = c("#4a505c")
METAL = c("#8a909c")
METAL_L = c("#c8ccd4")
SHADOW = c("#1f2a30", 70)


# ───────────────────────── 배경 ─────────────────────────
def draw_floor(img):
    """사무실 카펫 타일 (16px 격자, 두 톤 + 잔무늬)"""
    d = ImageDraw.Draw(img)
    rng = random.Random(11)
    a, b = c("#7d98a3"), c("#75919c")
    for ty, y in enumerate(range(WALL_H, H, 16)):
        for tx, x in enumerate(range(0, W, 16)):
            base = a if (tx + ty) % 2 == 0 else b
            rect(d, x, y, 16, 16, base)
            rect(d, x + 15, y, 1, 16, shade(base, -10))
            rect(d, x, y + 15, 16, 1, shade(base, -10))
            for _ in range(7):
                d.point((x + rng.randint(0, 14), y + rng.randint(0, 14)), fill=shade(base, rng.choice([-9, -6, 7, 10])))


def draw_wall(img):
    d = ImageDraw.Draw(img)
    rect(d, 0, 0, W, WALL_H, c("#ece6d8"))
    rect(d, 0, 0, W, 3, c("#8a8f98"))
    rect(d, 0, 3, W, 1, c("#b4b8c0"))
    # 회사 색 띠 + 아래 벽
    rect(d, 0, 25, W, 2, c("#e98a3c"))
    rect(d, 0, 27, W, 8, c("#dcd5c4"))
    rect(d, 0, 27, W, 1, c("#c8c0ac"))
    rect(d, 0, 35, W, 3, c("#6a6f78"))
    rect(d, 0, 35, W, 1, c("#8a909c"))
    over(img, 0, WALL_H, W, 2, c("#1f2a30", 60))
    over(img, 0, WALL_H + 2, W, 1, c("#1f2a30", 25))


def draw_window(img, x, y=5):
    """알루미늄 창틀 + 블라인드 + 먼 빌딩. 유리는 투명 (뒤에 하늘이 깔린다)"""
    d = ImageDraw.Draw(img)
    w, h = 40, 19
    rect(d, x - 1, y - 1, w + 2, h + 2, METAL_D)
    rect(d, x, y, w, h, METAL_L)
    rect(d, x + 2, y + 2, w - 4, h - 4, (0, 0, 0, 0))
    # 먼 빌딩 실루엣
    rng = random.Random(x)
    bx = x + 2
    while bx < x + w - 2:
        bw = min(rng.choice([4, 5, 6, 7]), x + w - 2 - bx)
        bh = rng.choice([3, 5, 6, 8])
        col = c(rng.choice(["#5f7890", "#6a849c", "#54708a"]))
        rect(d, bx, y + h - 2 - bh, bw, bh, col)
        for wy in range(y + h - 1 - bh, y + h - 3, 2):
            for wx in range(bx + 1, bx + bw - 1, 2):
                if rng.random() < 0.5:
                    d.point((wx, wy), fill=c("#ffe9a0"))
        bx += bw
    # 블라인드 (위쪽 6줄)
    for i in range(6):
        rect(d, x + 2, y + 2 + i, w - 4, 1, c("#f6f6f0") if i % 2 == 0 else c("#cdd2d8"))
    rect(d, x + w - 5, y + 8, 1, 6, c("#f6f6f0"))
    # 세로 창살 2개
    for mx in (x + 13, x + 26):
        rect(d, mx, y + 2, 1, h - 4, METAL_L)
    # 창턱
    rect(d, x - 2, y + h, w + 4, 2, c("#f4f0e6"))
    rect(d, x - 2, y + h + 2, w + 4, 1, METAL_D)


FONT35 = {
    "O": ["111", "101", "101", "101", "111"],
    "R": ["110", "101", "110", "101", "101"],
    "E": ["111", "100", "110", "100", "111"],
    "U": ["101", "101", "101", "101", "111"],
    "M": ["101", "111", "111", "101", "101"],
}


def draw_logo(img, x, y):
    """회사 간판: 오름(완만한 언덕) 마크 + OREUM"""
    d = ImageDraw.Draw(img)
    rect(d, x - 1, y - 1, 38, 14, METAL_D)
    rect(d, x, y, 36, 12, c("#ffffff"))
    rect(d, x, y + 11, 36, 1, c("#d8d8d0"))
    for i, hh in enumerate([1, 2, 4, 5, 6, 6, 5, 4, 2, 1]):
        rect(d, x + 2 + i, y + 10 - hh, 1, hh, c("#e98a3c"))
    for i, hh in enumerate([1, 2, 3, 3, 2, 1]):
        rect(d, x + 8 + i, y + 10 - hh, 1, hh, c("#c8661c"))
    lx = x + 15
    for ch in "OREUM":
        for ry, row in enumerate(FONT35[ch]):
            for rx, bit in enumerate(row):
                if bit == "1":
                    d.point((lx + rx, y + 4 + ry), fill=c("#3b2416"))
        lx += 4


def draw_clock(img, x, y):
    d = ImageDraw.Draw(img)
    d.ellipse([x, y, x + 11, y + 11], fill=METAL_D)
    d.ellipse([x + 1, y + 1, x + 10, y + 10], fill=c("#ffffff"))
    rect(d, x + 5, y + 3, 1, 3, c("#22262e"))
    rect(d, x + 6, y + 6, 3, 1, c("#d85a4a"))
    d.point([(x + 5, y + 2), (x + 9, y + 6), (x + 5, y + 9), (x + 2, y + 6)], fill=METAL)


def draw_whiteboard(img, x, y):
    d = ImageDraw.Draw(img)
    rect(d, x - 1, y - 1, 30, 18, METAL_D)
    rect(d, x, y, 28, 16, METAL_L)
    rect(d, x + 1, y + 1, 26, 13, c("#fbfbf6"))
    rect(d, x + 3, y + 3, 9, 1, c("#3f6fb5"))
    rect(d, x + 3, y + 5, 13, 1, c("#3f6fb5"))
    rect(d, x + 3, y + 7, 7, 1, c("#d85a4a"))
    for i, hh in enumerate([2, 4, 3, 6]):
        rect(d, x + 17 + i * 2, y + 12 - hh, 1, hh, c("#4a9b6e"))
    rect(d, x + 3, y + 10, 5, 2, c("#f0b840"))
    rect(d, x + 4, y + 14, 3, 1, c("#d85a4a"))
    rect(d, x + 9, y + 14, 3, 1, c("#3f6fb5"))


def draw_corkboard(img, x, y):
    d = ImageDraw.Draw(img)
    rect(d, x - 1, y - 1, 24, 15, METAL_D)
    rect(d, x, y, 22, 13, METAL_L)
    rect(d, x + 1, y + 1, 20, 11, c("#d9a868"))
    for nx, ny, col in [(2, 2, "#fff6c8"), (9, 2, "#ffd0d0"), (15, 2, "#d0f0d8"), (5, 7, "#d8e8ff"), (12, 7, "#fff6c8")]:
        rect(d, x + nx, y + ny, 5, 4, c(col))
        d.point((x + nx + 2, y + ny), fill=c("#d85a4a"))


def draw_extinguisher(img, x, y):
    d = ImageDraw.Draw(img)
    rect(d, x + 1, y - 2, 2, 2, METAL_D)
    rect(d, x + 3, y - 2, 2, 1, METAL_D)
    rect(d, x - 1, y, 6, 11, c("#7a1f1f"))
    rect(d, x, y, 4, 10, c("#d8483f"))
    rect(d, x, y, 1, 10, c("#ef7d66"))
    rect(d, x, y + 4, 4, 2, c("#f4f0e6"))


def draw_copier(img, x, y):
    """복합기. x,y = 왼쪽 위"""
    d = ImageDraw.Draw(img)
    over(img, x + 1, y + 26, 22, 3, SHADOW)
    rect(d, x - 1, y - 1, 24, 29, METAL_D)
    rect(d, x, y, 22, 27, c("#dfe3e8"))
    # 덮개
    rect(d, x, y, 22, 5, c("#b8bec8"))
    rect(d, x, y, 22, 1, c("#d8dce2"))
    rect(d, x, y + 5, 22, 1, METAL_D)
    # 조작부
    rect(d, x + 2, y + 7, 9, 4, c("#22262e"))
    rect(d, x + 3, y + 8, 5, 2, c("#8fd0f2"))
    d.point((x + 9, y + 8), fill=c("#6abf5a"))
    d.point((x + 9, y + 10), fill=c("#d85a4a"))
    rect(d, x + 13, y + 8, 7, 1, METAL)
    # 배출구 + 종이
    rect(d, x + 2, y + 13, 18, 3, c("#22262e"))
    rect(d, x + 5, y + 14, 12, 3, c("#ffffff"))
    rect(d, x + 6, y + 15, 7, 1, c("#b4b8c0"))
    # 용지함
    for dy in (19, 23):
        rect(d, x + 1, y + dy, 20, 3, c("#c8ccd4"))
        rect(d, x + 1, y + dy, 20, 1, c("#f0f2f5"))
        rect(d, x + 9, y + dy + 1, 4, 1, METAL_D)
    rect(d, x + 19, y + 6, 3, 21, c("#c8ccd4"))


def draw_bin(img, x, y):
    d = ImageDraw.Draw(img)
    over(img, x, y + 8, 8, 2, SHADOW)
    rect(d, x - 1, y - 1, 9, 10, METAL_D)
    rect(d, x, y, 7, 8, c("#6a7480"))
    rect(d, x, y, 7, 1, c("#22262e"))
    rect(d, x + 1, y + 2, 1, 5, c("#8a94a0"))
    rect(d, x + 2, y - 2, 3, 2, c("#ffffff"))


def draw_cabinet(img, x, y):
    d = ImageDraw.Draw(img)
    w, h = 15, 24
    over(img, x + 1, y + h - 1, w, 3, SHADOW)
    rect(d, x - 1, y - 1, w + 2, h + 2, METAL_D)
    rect(d, x, y, w, h, c("#aeb6c2"))
    rect(d, x, y, w, 2, c("#d0d6de"))
    for i in range(3):
        dy = y + 3 + i * 7
        rect(d, x + 1, dy, w - 2, 6, c("#98a2b0"))
        rect(d, x + 1, dy, w - 2, 1, c("#c0c8d2"))
        rect(d, x + 5, dy + 2, 5, 1, METAL_D)
        rect(d, x + 3, dy + 4, 5, 1, c("#f4f0e6"))


def draw_binders(img, x, y):
    """캐비닛 위 서류철"""
    d = ImageDraw.Draw(img)
    for i, col in enumerate(["#3f6fb5", "#d85a4a", "#4a9b6e", "#f0b840", "#3f6fb5"]):
        rect(d, x + i * 3, y, 3, 8, METAL_D)
        rect(d, x + i * 3, y, 2, 8, c(col))
        rect(d, x + i * 3, y + 2, 2, 2, c("#ffffff"))


def draw_cooler(img, x, y):
    d = ImageDraw.Draw(img)
    over(img, x, y + 27, 12, 3, SHADOW)
    rect(d, x + 1, y - 1, 9, 12, c("#2f5a80"))
    rect(d, x + 2, y, 7, 10, c("#7cc7ec"))
    rect(d, x + 3, y + 1, 1, 7, c("#d6f1fb"))
    rect(d, x + 2, y + 3, 7, 1, c("#5aaede"))
    rect(d, x - 1, y + 10, 13, 19, METAL_D)
    rect(d, x, y + 11, 11, 17, c("#f4f0e6"))
    rect(d, x, y + 11, 11, 1, c("#ffffff"))
    rect(d, x + 8, y + 12, 3, 16, c("#d8d2c4"))
    rect(d, x + 2, y + 14, 2, 2, c("#3f6fb5"))
    rect(d, x + 6, y + 14, 2, 2, c("#d85a4a"))
    rect(d, x + 1, y + 18, 9, 3, c("#b8b2a4"))


def draw_plant(img, x, y, big=True):
    """x,y = 화분 바닥 가운데"""
    d = ImageDraw.Draw(img)
    over(img, x - 6, y - 1, 13, 3, SHADOW)
    rect(d, x - 5, y - 9, 11, 9, METAL_D)
    rect(d, x - 4, y - 8, 9, 7, c("#f4f0e6"))
    rect(d, x - 4, y - 8, 9, 2, c("#ffffff"))
    rect(d, x + 2, y - 6, 2, 4, c("#d0cabb"))
    g1, g2, g3, go = c("#3f8f55"), c("#5aa85a"), c("#8fd07a"), c("#2a5a3a")
    leaves = [(-7, -17, 6, 8), (2, -18, 6, 9), (-3, -22, 6, 12), (-9, -12, 5, 5), (5, -12, 5, 5)]
    if not big:
        leaves = [(-5, -14, 5, 6), (1, -15, 5, 7), (-2, -17, 4, 8)]
    for lx, ly, lw, lh in leaves:
        d.ellipse([x + lx - 1, y + ly - 1, x + lx + lw, y + ly + lh], fill=go)
    for lx, ly, lw, lh in leaves:
        d.ellipse([x + lx, y + ly, x + lx + lw - 1, y + ly + lh - 1], fill=g1)
        d.ellipse([x + lx, y + ly, x + lx + lw - 2, y + ly + lh - 3], fill=g2)
        d.point([(x + lx + 1, y + ly + 1), (x + lx + 2, y + ly + 1), (x + lx + 1, y + ly + 2)], fill=g3)


def draw_partition(img, x, y, h):
    """자리 옆 칸막이 (세로 패널)"""
    d = ImageDraw.Draw(img)
    over(img, x + 5, y + 3, 2, h - 1, c("#1f2a30", 45))
    rect(d, x - 1, y - 1, 7, h + 2, c("#3a4658"))
    rect(d, x, y, 5, h, c("#8fa8c0"))
    rect(d, x, y, 1, h, c("#b2c6da"))
    rect(d, x + 4, y, 1, h, c("#738ca6"))
    rect(d, x, y, 5, 2, c("#e4e9f0"))
    rect(d, x, y + h - 2, 5, 2, c("#5a6a80"))


def draw_meeting(img, x, y):
    """회의 구역: 짙은 카펫 + 긴 테이블 + 의자 4개. x,y = 구역 왼쪽 위 (104x44)"""
    d = ImageDraw.Draw(img)
    rect(d, x, y, 104, 44, c("#536c77"))
    rect(d, x + 1, y + 1, 102, 42, c("#627d89"))
    rng = random.Random(3)
    for _ in range(160):
        d.point((x + rng.randint(2, 101), y + rng.randint(2, 41)), fill=c(rng.choice(["#5a7480", "#6a8692"])))
    tx, ty, tw, th = x + 22, y + 13, 60, 18

    def seat(sx, sy):
        d.rounded_rectangle([sx - 1, sy - 1, sx + 10, sy + 8], radius=2, fill=c("#22363e"))
        d.rounded_rectangle([sx, sy, sx + 9, sy + 7], radius=2, fill=c("#4a7a8a"))
        rect(d, sx + 1, sy + 1, 7, 1, c("#6aa0ae"))

    for sx in (tx + 8, tx + 40):
        seat(sx, ty - 7)
    over(img, tx + 1, ty + th, tw, 4, SHADOW)
    rect(d, tx - 1, ty - 1, tw + 2, th + 2, OUTLINE)
    rect(d, tx, ty, tw, th, c("#d2b47e"))
    rect(d, tx, ty, tw, th - 3, c("#f1ece0"))
    rect(d, tx, ty, tw, 1, c("#ffffff"))
    rect(d, tx + 3, ty + th + 1, 3, 4, METAL_D)
    rect(d, tx + tw - 6, ty + th + 1, 3, 4, METAL_D)
    # 노트북, 서류, 머그
    rect(d, tx + 24, ty + 3, 12, 8, METAL_D)
    rect(d, tx + 25, ty + 4, 10, 5, c("#8fd0f2"))
    rect(d, tx + 26, ty + 5, 5, 1, c("#ffffff"))
    rect(d, tx + 23, ty + 11, 14, 2, METAL_L)
    rect(d, tx + 6, ty + 4, 8, 6, c("#ffffff"))
    rect(d, tx + 7, ty + 5, 5, 1, METAL)
    rect(d, tx + 7, ty + 7, 6, 1, METAL)
    rect(d, tx + 46, ty + 5, 5, 5, OUTLINE)
    rect(d, tx + 47, ty + 6, 3, 3, c("#e98a3c"))
    for sx in (tx + 8, tx + 40):
        seat(sx, ty + th + 2)


def make_room():
    img = Image.new("RGBA", (W, H), c("#7d98a3"))
    draw_floor(img)
    draw_wall(img)
    for wx in WINDOWS_X:
        draw_window(img, wx)
    draw_logo(img, 8, 7)
    draw_clock(img, 113, 8)
    draw_whiteboard(img, 190, 6)
    draw_extinguisher(img, 104, 27)
    draw_copier(img, 2, 21)
    draw_cabinet(img, 268, 22)
    draw_cabinet(img, 284, 22)
    draw_binders(img, 269, 13)
    draw_plant(img, 292, 22, big=False)
    draw_cooler(img, 304, 16)
    draw_meeting(img, 108, 90)
    for tx, ty in SEATS.values():
        draw_partition(img, (tx - 1) * 16 - 7, ty * 16 - 8, 44)
    draw_bin(img, 250, 186)
    draw_plant(img, 12, 200)
    draw_plant(img, 308, 198)
    return img


# ───────────────────────── 가구 스프라이트 ─────────────────────────
def make_desk():
    img = Image.new("RGBA", (48, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    over(img, 1, 21, 46, 3, SHADOW)
    # 금속 다리
    for lx in (1, 43):
        rect(d, lx, 18, 4, 5, METAL_D)
        rect(d, lx + 1, 18, 1, 4, METAL)
    # 앞 가림판
    rect(d, 0, 9, 48, 11, c("#3a4658"))
    rect(d, 1, 9, 46, 10, c("#9fb0c0"))
    rect(d, 1, 17, 46, 2, c("#8798aa"))
    rect(d, 1, 10, 46, 1, c("#7a8c9e"))
    for dy in (11, 15):
        rect(d, 31, dy, 14, 3, c("#6a7c90"))
        rect(d, 32, dy, 12, 2, c("#c0ccd8"))
        rect(d, 37, dy + 1, 2, 1, METAL_D)
    # 상판 (밝은 단풍나무)
    rect(d, 0, 0, 48, 10, OUTLINE)
    rect(d, 1, 1, 46, 8, c("#ecd2a4"))
    rect(d, 1, 1, 46, 1, c("#f7e4be"))
    rect(d, 1, 8, 46, 1, c("#d2b47e"))
    # 키보드
    rect(d, 18, 4, 12, 4, c("#3a3f4a"))
    rect(d, 19, 5, 10, 2, c("#d8dce6"))
    for kx in range(20, 29, 2):
        d.point((kx, 6), fill=c("#9aa0ae"))
    # 서류, 포스트잇, 머그
    rect(d, 32, 2, 7, 6, c("#b8b2a4"))
    rect(d, 32, 2, 7, 5, c("#ffffff"))
    rect(d, 33, 3, 4, 1, c("#9aa0ae"))
    rect(d, 33, 5, 5, 1, c("#9aa0ae"))
    rect(d, 2, 5, 3, 3, c("#ffe36a"))
    rect(d, 41, 3, 4, 5, OUTLINE)
    rect(d, 42, 4, 2, 3, c("#e98a3c"))
    rect(d, 42, 4, 2, 1, c("#5a3620"))
    d.point((45, 5), fill=OUTLINE)
    return img


def make_chair():
    img = Image.new("RGBA", (16, 18), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    col, hi, dk, ol = c("#3f4654"), c("#5a6274"), c("#2c323e"), c("#1c2028")
    d.rounded_rectangle([1, 0, 14, 15], radius=3, fill=ol)
    d.rounded_rectangle([2, 1, 13, 14], radius=2, fill=col)
    rect(d, 3, 2, 10, 1, hi)
    rect(d, 3, 3, 1, 9, hi)
    rect(d, 11, 4, 2, 10, dk)
    rect(d, 6, 15, 4, 3, ol)
    return img


def make_monitor():
    img = Image.new("RGBA", (42, 14), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    screens = [("#56607a", None), ("#c8ecff", 0), ("#d8f4e4", 1)]
    for i, (bg, mode) in enumerate(screens):
        x = i * 14
        rect(d, x, 0, 14, 11, c("#22262e"))
        rect(d, x + 1, 1, 12, 9, c("#3a3f4a"))
        rect(d, x + 2, 2, 10, 7, c(bg))
        if mode is None:
            d.point([(x + 3, y) for y in (3, 4)], fill=c("#7a86a4"))
        else:
            lines = [(3, 6), (4, 4), (6, 7)] if mode == 0 else [(3, 4), (5, 7), (7, 5)]
            for ly, lw in lines:
                rect(d, x + 3, ly, lw, 1, c("#3f6fb5") if mode == 0 else c("#3f8f55"))
        rect(d, x + 6, 11, 2, 2, c("#22262e"))
        rect(d, x + 3, 13, 8, 1, c("#22262e"))
    return img


# ───────────────────────── 아이콘 ─────────────────────────
# o 외곽  w 흰색  b 파랑  y 노랑  t 살구  g 초록  r 빨강
ICONS = {
    "task": [
        "....oooo....",
        "..ooottooo..",
        "..owwwwwwo..",
        "..owbbbbwo..",
        "..owwwwwwo..",
        "..owbbbwwo..",
        "..owwwwwwo..",
        "..owbbbbwo..",
        "..owwwwwwo..",
        "..owbbwwwo..",
        "..owwwwwwo..",
        "..oooooooo..",
    ],
    "odi": [
        ".....oo.....",
        ".....yy.....",
        "..oooooooo..",
        "..obbbbbbo..",
        "..obwbbwbo..",
        "..obwbbwbo..",
        "..obbbbbbo..",
        "..obowwobo..",
        "..obbbbbbo..",
        "..oooooooo..",
        "...ob..bo...",
        "...oo..oo...",
    ],
    "data": [
        "............",
        ".oooo.......",
        ".oyyyooooo..",
        ".oyyyyyyyyo.",
        ".oooooooooo.",
        ".oyyyyyyyyo.",
        ".oyyyyyyyyo.",
        ".oyyyyyyyyo.",
        ".oyyyyyyyyo.",
        ".oyyyyyyyyo.",
        ".oooooooooo.",
        "............",
    ],
    "people": [
        "............",
        "..ooo...ooo.",
        ".ottto.ottto",
        ".ottto.ottto",
        "..ooo...ooo.",
        ".ooooo.ooooo",
        "obbbbboggggo",
        "obbbbboggggo",
        "obbbbboggggo",
        "oooooooooooo",
        "............",
        "............",
    ],
    "submit": [
        "............",
        ".........ooo",
        ".......oowwo",
        ".....oowwwo.",
        "...oowwwwwo.",
        ".oowwwwwwo..",
        ".ooooowwwo..",
        ".....owwo...",
        ".....owwo...",
        ".....owo....",
        ".....oo.....",
        "............",
    ],
    "exit": [
        "..ooooooo...",
        "..ottttto...",
        "..ottttto...",
        "..ottttto...",
        "..otttyto...",
        "..ottttto...",
        "..ottttto...",
        "..ottttto...",
        "..ottttto...",
        "..ooooooo...",
        "............",
        "............",
    ],
}
ICON_ORDER = ["task", "odi", "data", "people", "submit", "exit"]  # index.css 의 .ico-* 순서와 맞춤


def make_icons():
    pal = {"o": c("#3b2416"), "w": c("#ffffff"), "b": c("#4a8fd0"), "y": c("#f5c24a"), "t": c("#e9c08a"), "g": c("#55ad7c"), "r": c("#d8483f")}
    img = Image.new("RGBA", (12 * len(ICON_ORDER), 12), (0, 0, 0, 0))
    for i, name in enumerate(ICON_ORDER):
        rows = ICONS[name]
        assert len(rows) == 12, name
        for y, row in enumerate(rows):
            assert len(row) == 12, (name, y, row)
            for x, ch in enumerate(row):
                if ch != ".":
                    img.putpixel((i * 12 + x, y), pal[ch])
    return img


# ───────────────────────── 캐릭터 ─────────────────────────
# SD(2등신) 도트: 굵은 검정 외곽선, 풍성한 3톤 머리, 세로로 긴 눈. 한 칸 24x30, 머리 19줄 + 몸 11줄.
# K 외곽선  h 머리  H 머리 밝은 톤  d 머리 어두운 톤  s 피부  S 피부 그늘  L 속눈썹  E 눈동자(진)  e 눈동자(연)  w 눈 하이라이트
# r 볼터치  m 입  g 안경  n 머리핀·리본  j 겉옷  J 겉옷 그늘  k 셔츠·블라우스  t 넥타이(없으면 셔츠색)  l 사원증 줄  W 사원증
# p 바지·치마  b 신발
CW, CH = 24, 30

HEAD = [
    "........KKKKKKKK........",
    "......KKhhHHHHhhKK......",
    "....KKhhHHHHHHhhhhKK....",
    "...KhhhHHHhhhhhhhhhhK...",
    "..KhhhHHhhhhhhhhhhhhdK..",
    "..KhhhhhhhhhhhhhhhhhdK..",
    ".KhhhhhhhhhhhhhhhhhhhdK.",
    ".KhhhhhhhhhhhhhhhhhhddK.",
    ".KhhhhhhhshhhhshhhhhhdK.",  # 8~9행 앞머리는 머리 모양마다 바꾼다
    ".KhhhsshssshssshsshhhdK.",
    ".Khhh" + "s" * 14 + "hhdK.",
    ".KhhhsLLLssssssLLLshhdK.",
    ".KhhhsEEEssssssEEEshhdK.",
    ".KhhhsewEssssssewEshhdK.",
    ".KhhhreeesssssseeerhhdK.",
    ".KhhhssssssmmsssssshhdK.",
    ".KhhhKssssssssssssKhhdK.",
    ".KhhhhKKssssssssKKhhhdK.",
    ".KhhhhhhKKKKKKKKhhhhhdK.",
]

BODY = [
    ".......KkkSSSSkkK.......",
    "......KjjjkttkjjjK......",
    ".....KjjjjkttkjjjjK.....",
    ".....KjKjjjttjjjKjK.....",
    ".....KjKJjjttjjJKjK.....",
    ".....KsKJjjjjjjJKsK.....",
    "......KKKJJJJJJKKK......",
    "........KppppppK........",
    "........KppKKppK........",
    "........KbbKKbbK........",
    "........KKKKKKKK........",
]

BANGS = {
    "part": [".KhhhhssshhhhhhhhhhhhdK.", ".KhhhsssssssshhhhhhhhdK."],  # 옆 가르마
    "sweep": [".KhhhhhhhhhhhhhhsshhhdK.", ".KhhhhhhhhsssssssshhhdK."],  # 넘긴 앞머리
    "bob": [".KhhhhhhhshhhhshhhhhhdK.", ".KhhhsshssshssshsshhhdK."],  # 시스루 뱅 단발
    "long": [".KhhhhhhhhhshhhhhhhhhdK.", ".KhhhhsssshssshssshhhdK."],  # 긴 머리
    "spiky": [".KhhhshhhshhhhshhhshhdK.", ".KhhsssshsssssshsssshdK."],  # 삐죽
}
SHORT = ("part", "sweep", "spiky")

CHARS = [  # chars.png 의 칸 순서 = 이 순서 (layout.ts 의 CHAR_ORDER 와 맞춤)
    # 강지훈: 남색 정장 + 흰 셔츠 + 붉은 넥타이, 안경
    dict(id="kang", hair="part", hc=("#3b3550", "#6a6390", "#231f33"), eye=("#2a3a70", "#6a8ad8"), coat=("#34446e", "#243052"), shirt="#ffffff", tie="#c8483f", bottom="#2c3654", extra="glasses"),
    # 정우진: 하늘색 셔츠 + 사원증, 소매 걷음
    dict(id="jung", hair="sweep", hc=("#8a5a34", "#c08a54", "#58341a"), eye=("#2f5a3a", "#6ab87a"), coat=("#a9cdf0", "#82acd8"), shirt="#ffffff", tie=None, bottom="#4a4f5e", extra="badge"),
    # 박소연: 로즈 재킷 + 흰 블라우스
    dict(id="park", hair="bob", hc=("#4a3038", "#7a5060", "#2a181e"), eye=("#6a2a3a", "#d87a8a"), coat=("#d8607e", "#b0445e"), shirt="#fff6f0", tie=None, bottom="#3a3440", extra="necklace"),
    # 이하늘: 머스터드 가디건 + 흰 블라우스 + 리본, 머리핀
    dict(id="lee", hair="long", hc=("#c88a4a", "#f0c080", "#8a5626"), eye=("#7a4a1a", "#e0a850"), coat=("#f0b840", "#cc9428"), shirt="#ffffff", tie=None, bottom="#5a6a8a", extra="ribbon"),
    # 수습(나): 흰 셔츠 + 느슨한 남색 넥타이 + 사원증
    dict(id="me", hair="spiky", hc=("#6a4630", "#a47650", "#3e2616"), eye=("#2a4a5a", "#6ab0c8"), coat=("#f4f1ea", "#d2ccc0"), shirt="#ffffff", tie="#3f5fa8", bottom="#4a5a7a", extra="badge"),
]


def char_rows(spec, blink):
    rows = [list(r) for r in HEAD] + [list(r) for r in BODY]
    style = spec["hair"]
    rows[8], rows[9] = list(BANGS[style][0]), list(BANGS[style][1])

    def put(y, x, ch):
        rows[y][x] = ch

    def span(y, x0, text):
        for i, ch in enumerate(text):
            rows[y][x0 + i] = ch

    # 머리카락 결
    for y, x in ((5, 8), (6, 8), (5, 15), (6, 16), (7, 12)):
        put(y, x, "d")
    if style in SHORT:
        for y in (10, 11):  # 구레나룻까지만
            span(y, 0, "...Kh")
            span(y, 19, "hK...")
        for y in (12, 13, 14, 15):
            span(y, 0, "....K")
            span(y, 19, "K....")
        rows[16] = list(".....K" + "s" * 12 + "K.....")
        rows[17] = list("......KKssssssssKK......")
        rows[18] = list("........KKKKKKKK........")
        for y in (6, 7, 8):  # 위쪽 머리 폭을 줄여 버섯 모양 방지
            span(y, 0, "..K")
            span(y, 21, "K..")
        span(9, 0, "...K")
        span(9, 20, "K...")
    if style == "long":  # 어깨 아래까지
        for y in range(19, 25):
            span(y, 1, "Khhh")
            span(y, 19, "hhdK")
        span(25, 1, "KKKK")
        span(25, 19, "KKKK")
        for y, x in ((3, 16), (3, 17), (4, 17)):
            put(y, x, "n")
    if style == "spiky":  # 뻗친 머리 한 가닥
        rows[0] = list("........KKKKKKKK.KK.....")
        rows[1] = list("......KKhhHHHHhhKhhK....")
    if spec["tie"] is None:  # 넥타이 없는 옷: 그 자리는 셔츠
        for y in range(19, 30):
            rows[y] = ["k" if ch == "t" else ch for ch in rows[y]]
    extra = spec["extra"]
    if extra == "glasses":
        for x in (5, 9, 10, 11, 12, 13, 14, 18):
            put(12, x, "g")
        for x in (5, 9, 14, 18):
            put(13, x, "g")
    if extra == "badge":
        for y, x in ((20, 9), (20, 14), (21, 9), (21, 14), (22, 10), (22, 13)):
            put(y, x, "l")
        span(23, 11, "WW")
        span(24, 11, "WW")
    if extra == "necklace":
        span(21, 11, "nn")
    if extra == "ribbon":
        span(20, 10, "nkkn")
        span(21, 11, "nn")
    if blink:
        rows[11] = ["s" if ch == "L" else ch for ch in rows[11]]
        for y in (12, 13, 14):
            rows[y] = ["s" if ch in "Eew" else ch for ch in rows[y]]
        span(13, 6, "LLL")
        span(13, 15, "LLL")
    return rows


def make_chars():
    img = Image.new("RGBA", (CW * len(CHARS) * 2, CH), (0, 0, 0, 0))
    for ci, spec in enumerate(CHARS):
        hair, hair_hi, hair_dk = spec["hc"]
        coat, coat_sh = spec["coat"]
        pal = {
            "K": c("#1c1418"),
            "h": c(hair),
            "H": c(hair_hi),
            "d": c(hair_dk),
            "s": c("#ffe2c8"),
            "S": c("#f2b89a"),
            "L": c("#2a1a22"),
            "E": c(spec["eye"][0]),
            "e": c(spec["eye"][1]),
            "w": c("#ffffff"),
            "r": c("#ffb0a8"),
            "m": c("#d8685a"),
            "g": c("#3a4468"),
            "n": c("#ff6f96"),
            "j": c(coat),
            "J": c(coat_sh),
            "k": c(spec["shirt"]),
            "t": c(spec["tie"] or spec["shirt"]),
            "l": c("#2f6fd0"),
            "W": c("#ffffff"),
            "p": c(spec["bottom"]),
            "b": c("#2a2028"),
        }
        for blink in (0, 1):
            rows = char_rows(spec, blink)
            assert len(rows) == CH, len(rows)
            ox = (ci * 2 + blink) * CW
            for y, row in enumerate(rows):
                assert len(row) == CW, (spec["id"], y, len(row), "".join(row))
                for x, ch in enumerate(row):
                    if ch != ".":
                        img.putpixel((ox + x, y), pal[ch])
    return img


# 자리 칸 기준 캐릭터 위치 (scene.ts 의 CHAR_DX, CHAR_DY, CHAIR_DY 와 같아야 한다)
CHAR_DX, CHAR_DY, CHAIR_DY = -4, -9, 4


# ───────────────────────── 출력 ─────────────────────────
def make_preview(room, chars, desk, chair, monitor):
    """scene.ts 와 같은 배치로 합성 (낮 하늘색). 눈으로 확인하는 용도"""
    img = Image.new("RGBA", (W, H), c("#8fd0f2"))
    img.alpha_composite(room)
    for i, spec in enumerate(CHARS):
        tx, ty = SEATS[spec["id"]]
        img.alpha_composite(chair, (tx * 16, ty * 16 + CHAIR_DY))
        img.alpha_composite(chars.crop((i * 2 * CW, 0, i * 2 * CW + CW, CH)), (tx * 16 + CHAR_DX, ty * 16 + CHAR_DY))
        img.alpha_composite(desk, ((tx - 1) * 16, (ty + 1) * 16 - 2))
        img.alpha_composite(monitor.crop((14, 0, 28, 14)), ((tx - 1) * 16 + 2, (ty + 1) * 16 - 11))
    return img.resize((W * 4, H * 4), Image.NEAREST)


def make_char_sheet_preview(chars):
    bg = Image.new("RGBA", chars.size, c("#7d98a3"))
    bg.alpha_composite(chars)
    return bg.resize((chars.width * 8, chars.height * 8), Image.NEAREST)


def main():
    os.makedirs(OUT, exist_ok=True)
    room, chars, desk, chair, monitor, icons = make_room(), make_chars(), make_desk(), make_chair(), make_monitor(), make_icons()
    for name, im in [("room", room), ("chars", chars), ("desk", desk), ("chair", chair), ("monitor", monitor), ("icons", icons)]:
        im.save(os.path.join(OUT, f"{name}.png"))
    make_preview(room, chars, desk, chair, monitor).save(os.path.join(OUT, "preview.png"))
    make_char_sheet_preview(chars).save(os.path.join(OUT, "preview_chars.png"))
    print("ok ->", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
