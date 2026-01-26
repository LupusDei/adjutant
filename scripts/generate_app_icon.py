#!/usr/bin/env python3
"""
Generate SC2 Adjutant-inspired iOS app icon v3.

Professional quality design with:
- Sleek chrome/metallic face with realistic sheen
- Luminous glowing cyan/green eyes with bloom effect
- Circuit-trace patterns
- Clean, geometric cybernetic aesthetic
"""

import os
import math
import json

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

# Color palette (from requirements)
BLACK_PRIMARY = (10, 10, 10)           # #0A0A0A
BLACK_SECONDARY = (26, 26, 26)         # #1A1A1A
DARK_GRAY = (35, 38, 45)               # Face base
MID_GRAY = (55, 60, 70)                # Face mid-tone
LIGHT_GRAY = (85, 90, 100)             # Highlights
CHROME_HIGHLIGHT = (140, 150, 170)     # Chrome specular

# CRT phosphor greens
GREEN_BRIGHT = (0, 255, 65)            # #00FF41
GREEN_NEON = (57, 255, 20)             # #39FF14
GREEN_GLOW = (0, 220, 60)              # Glow color
GREEN_DIM = (0, 60, 25)                # Circuit traces

# Electric purple
PURPLE_PRIMARY = (139, 92, 246)        # #8B5CF6
PURPLE_SECONDARY = (168, 85, 247)      # #A855F7
PURPLE_GLOW = (120, 70, 220)


def create_radial_gradient(size, center, inner_color, outer_color, radius):
    """Create a radial gradient image."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    cx, cy = center

    for y in range(size):
        for x in range(size):
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            if dist <= radius:
                t = dist / radius
                r = int(inner_color[0] * (1 - t) + outer_color[0] * t)
                g = int(inner_color[1] * (1 - t) + outer_color[1] * t)
                b = int(inner_color[2] * (1 - t) + outer_color[2] * t)
                a = int(inner_color[3] * (1 - t) + outer_color[3] * t) if len(inner_color) > 3 else 255
                img.putpixel((x, y), (r, g, b, a))

    return img


def draw_circuit_pattern(draw, size, density=0.012):
    """Draw subtle circuit board pattern on background."""
    import random
    random.seed(42)

    # Horizontal and vertical traces
    num_traces = int(size * density)

    for _ in range(num_traces):
        x = random.randint(0, size)
        y = random.randint(0, size)
        length = random.randint(size // 25, size // 8)
        direction = random.choice(['h', 'v'])

        # Trace with slight glow effect
        trace_color = (0, 50, 20, 80)
        if direction == 'h':
            draw.line([(x, y), (min(x + length, size), y)], fill=trace_color, width=1)
        else:
            draw.line([(x, y), (x, min(y + length, size))], fill=trace_color, width=1)

        # Node at intersections
        if random.random() > 0.6:
            node_size = random.randint(2, 3)
            draw.ellipse([x - node_size, y - node_size, x + node_size, y + node_size],
                        fill=(0, 70, 30, 100))

    # Add some brighter circuit nodes
    for _ in range(int(size * 0.003)):
        x = random.randint(int(size * 0.1), int(size * 0.9))
        y = random.randint(int(size * 0.1), int(size * 0.9))
        node_size = random.randint(1, 2)
        draw.ellipse([x - node_size, y - node_size, x + node_size, y + node_size],
                    fill=(0, 100, 40, 150))


def draw_metallic_face(img, size):
    """Draw the stylized android face with metallic finish."""
    draw = ImageDraw.Draw(img, 'RGBA')
    cx = size // 2
    cy = size // 2

    # Face dimensions
    face_width = int(size * 0.62)
    face_height = int(size * 0.72)

    # Key Y positions
    face_top = cy - face_height // 2 + int(size * 0.06)
    face_bottom = cy + face_height // 2 - int(size * 0.02)
    forehead_y = face_top + int(size * 0.14)
    chin_y = face_bottom - int(size * 0.06)
    chin_width = int(face_width * 0.22)

    # Face left/right
    face_left = cx - face_width // 2
    face_right = cx + face_width // 2

    # Angular face polygon (more refined shape)
    face_points = [
        (cx, face_top),                                          # Crown
        (face_right - int(size * 0.04), forehead_y),             # Top right temple
        (face_right, cy - int(size * 0.06)),                     # Right upper cheek
        (face_right - int(size * 0.02), cy + int(size * 0.12)),  # Right lower cheek
        (cx + chin_width + int(size * 0.04), chin_y),            # Jaw right
        (cx, face_bottom),                                        # Chin point
        (cx - chin_width - int(size * 0.04), chin_y),            # Jaw left
        (face_left + int(size * 0.02), cy + int(size * 0.12)),   # Left lower cheek
        (face_left, cy - int(size * 0.06)),                      # Left upper cheek
        (face_left + int(size * 0.04), forehead_y),              # Top left temple
    ]

    # Draw base face (dark)
    draw.polygon(face_points, fill=DARK_GRAY)

    # Inner face panel (slightly lighter) with offset for depth
    inner_scale = 0.88
    inner_offset_y = int(size * 0.008)
    inner_points = []
    for px, py in face_points:
        dx = (px - cx) * inner_scale
        dy = (py - cy) * inner_scale
        inner_points.append((cx + dx, cy + dy + inner_offset_y))
    draw.polygon(inner_points, fill=MID_GRAY)

    # Add subtle metallic sheen (gradient on upper face)
    highlight_y = cy - int(size * 0.10)
    highlight_width = int(size * 0.28)
    highlight_height = int(size * 0.025)
    for i in range(highlight_height):
        progress = i / highlight_height
        # Fade from center outward
        alpha = int(25 * (1 - progress * 0.8))
        y = highlight_y - highlight_height // 2 + i
        # Tapered width
        w = highlight_width * (1 - progress * 0.5)
        draw.line([
            (cx - w, y),
            (cx + w, y)
        ], fill=(*LIGHT_GRAY[:3], alpha), width=1)

    # Central vertical line (face divider)
    line_y_start = face_top + int(size * 0.16)
    line_y_end = chin_y - int(size * 0.03)
    draw.line([(cx, line_y_start), (cx, line_y_end)],
              fill=(70, 75, 85), width=max(2, size // 180))

    # Add subtle edge highlights (left edge catch light)
    for i, (px, py) in enumerate(face_points[7:10]):  # Left side
        next_idx = (i + 1) % 3 + 7
        if next_idx < len(face_points):
            npx, npy = face_points[next_idx]
            draw.line([(px + 2, py), (npx + 2, npy)],
                     fill=(*LIGHT_GRAY[:3], 60), width=1)

    return draw


def draw_forehead_gem(img, size):
    """Draw the purple accent gem on forehead."""
    draw = ImageDraw.Draw(img, 'RGBA')
    cx = size // 2
    cy = size // 2

    # Position gem higher on forehead, above the eye level
    face_top = cy - int(size * 0.36) + int(size * 0.06)
    gem_y = face_top + int(size * 0.16)
    gem_size = int(size * 0.038)

    # Subtle gem glow (small)
    for i in range(5, 0, -1):
        radius = gem_size * 1.2 * (i / 5)
        alpha = int(20 * (i / 5))
        draw.ellipse([
            cx - radius, gem_y - radius,
            cx + radius, gem_y + radius
        ], fill=(*PURPLE_GLOW[:3], alpha))

    # Main gem shape (diamond)
    gem_points = [
        (cx, gem_y - gem_size),       # Top
        (cx + gem_size, gem_y),       # Right
        (cx, gem_y + gem_size),       # Bottom
        (cx - gem_size, gem_y),       # Left
    ]
    draw.polygon(gem_points, fill=PURPLE_PRIMARY)

    # Gem inner highlight (upper portion)
    highlight_size = gem_size * 0.55
    highlight_points = [
        (cx, gem_y - gem_size + 2),
        (cx + highlight_size * 0.7, gem_y - highlight_size * 0.2),
        (cx, gem_y + highlight_size * 0.3),
        (cx - highlight_size * 0.7, gem_y - highlight_size * 0.2),
    ]
    draw.polygon(highlight_points, fill=PURPLE_SECONDARY)

    # Bright specular dot
    spec_size = int(gem_size * 0.18)
    spec_y = gem_y - gem_size * 0.35
    draw.ellipse([
        cx - spec_size, spec_y - spec_size,
        cx + spec_size, spec_y + spec_size
    ], fill=(220, 200, 255, 180))


def draw_luminous_eyes(img, size):
    """Draw the signature glowing eyes with bloom effect."""
    draw = ImageDraw.Draw(img, 'RGBA')
    cx = size // 2
    cy = size // 2

    eye_y = cy - int(size * 0.015)
    eye_spacing = int(size * 0.155)
    eye_width = int(size * 0.115)
    eye_height = int(size * 0.038)

    for eye_x in [cx - eye_spacing, cx + eye_spacing]:
        # Eye socket (dark recessed area)
        socket_w = eye_width + int(size * 0.015)
        socket_h = eye_height + int(size * 0.015)
        draw.ellipse([
            eye_x - socket_w, eye_y - socket_h,
            eye_x + socket_w, eye_y + socket_h
        ], fill=(8, 8, 10))

        # Main eye shape (angular almond)
        eye_points = [
            (eye_x - eye_width, eye_y),                    # Left tip
            (eye_x - eye_width * 0.55, eye_y - eye_height),  # Top left
            (eye_x + eye_width * 0.55, eye_y - eye_height),  # Top right
            (eye_x + eye_width, eye_y),                    # Right tip
            (eye_x + eye_width * 0.55, eye_y + eye_height),  # Bottom right
            (eye_x - eye_width * 0.55, eye_y + eye_height),  # Bottom left
        ]
        draw.polygon(eye_points, fill=GREEN_BRIGHT)

        # Eye gradient layers (brighter toward center)
        for layer in range(3):
            scale = 0.85 - layer * 0.15
            layer_points = []
            for px, py in eye_points:
                dx = (px - eye_x) * scale
                dy = (py - eye_y) * scale
                layer_points.append((eye_x + dx, eye_y + dy))

            brightness = min(255, GREEN_NEON[1] + layer * 30)
            layer_color = (min(255, 100 + layer * 50), brightness, min(255, 80 + layer * 40))
            draw.polygon(layer_points, fill=layer_color)

        # Bright center core
        core_w = eye_width * 0.35
        core_h = eye_height * 0.5
        draw.ellipse([
            eye_x - core_w, eye_y - core_h,
            eye_x + core_w, eye_y + core_h
        ], fill=(220, 255, 220))

        # Hot spot (small bright specular)
        hot_size = int(size * 0.008)
        hot_x = eye_x - eye_width * 0.2
        hot_y = eye_y - eye_height * 0.3
        draw.ellipse([
            hot_x - hot_size, hot_y - hot_size,
            hot_x + hot_size, hot_y + hot_size
        ], fill=(255, 255, 255, 200))


def add_eye_glow(img, size):
    """Add subtle glow effect around the eyes using screen blending."""
    cx = size // 2
    cy = size // 2
    eye_y = cy - int(size * 0.015)
    eye_spacing = int(size * 0.155)
    eye_width = int(size * 0.115)

    # Create glow layer
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)

    # Draw bright eye shapes on the glow layer
    for eye_x in [cx - eye_spacing, cx + eye_spacing]:
        # Draw solid bright ellipse
        glow_w = eye_width * 1.2
        glow_h = int(size * 0.038) * 1.2
        glow_draw.ellipse([
            eye_x - glow_w, eye_y - glow_h,
            eye_x + glow_w, eye_y + glow_h
        ], fill=(0, 255, 80, 180))

    # Heavy blur to create glow
    glow = glow.filter(ImageFilter.GaussianBlur(radius=size // 25))

    # Composite using screen-like blend (additive on dark areas)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Create result by blending
    result = img.copy()
    result = Image.alpha_composite(result, glow)

    return result


def add_face_details(img, size):
    """Add panel lines and status indicators."""
    draw = ImageDraw.Draw(img, 'RGBA')
    cx = size // 2
    cy = size // 2

    line_width = max(1, size // 350)

    # Cheek panel lines (subtle)
    cheek_offset = int(size * 0.20)
    cheek_y = cy + int(size * 0.06)

    # Left cheek accent
    draw.line([
        (cx - cheek_offset - int(size * 0.04), cheek_y - int(size * 0.02)),
        (cx - cheek_offset + int(size * 0.01), cheek_y + int(size * 0.08))
    ], fill=(45, 48, 55, 180), width=line_width)

    # Right cheek accent (mirrored)
    draw.line([
        (cx + cheek_offset + int(size * 0.04), cheek_y - int(size * 0.02)),
        (cx + cheek_offset - int(size * 0.01), cheek_y + int(size * 0.08))
    ], fill=(45, 48, 55, 180), width=line_width)

    # Status indicators below eyes
    indicator_y = cy + int(size * 0.10)
    indicator_size = int(size * 0.011)

    for x_offset in [-0.075, 0.075]:
        ix = cx + int(size * x_offset)

        # Indicator glow
        for i in range(5, 0, -1):
            r = indicator_size + i
            alpha = int(30 * (i / 5))
            draw.ellipse([ix - r, indicator_y - r, ix + r, indicator_y + r],
                        fill=(0, 200, 100, alpha))

        # Indicator core
        draw.ellipse([
            ix - indicator_size, indicator_y - indicator_size,
            ix + indicator_size, indicator_y + indicator_size
        ], fill=GREEN_GLOW)

        # Bright center
        tiny = indicator_size // 2
        draw.ellipse([ix - tiny, indicator_y - tiny, ix + tiny, indicator_y + tiny],
                    fill=(200, 255, 200))

    return img


def generate_icon(size):
    """Generate the complete icon at specified size."""
    # Create base with dark background
    img = Image.new('RGBA', (size, size), BLACK_PRIMARY)
    draw = ImageDraw.Draw(img, 'RGBA')

    # Subtle radial vignette (darker edges)
    vignette_size = int(size * 0.55)
    for i in range(vignette_size, 0, -3):
        t = i / vignette_size
        color = (
            int(BLACK_SECONDARY[0] * t + BLACK_PRIMARY[0] * (1 - t)),
            int(BLACK_SECONDARY[1] * t + BLACK_PRIMARY[1] * (1 - t)),
            int(BLACK_SECONDARY[2] * t + BLACK_PRIMARY[2] * (1 - t)),
            int(255 * t)
        )
        draw.ellipse([
            size // 2 - i, size // 2 - i,
            size // 2 + i, size // 2 + i
        ], fill=color)

    # Circuit pattern (subtle background detail)
    if size >= 256:
        draw_circuit_pattern(draw, size)

    # Draw main face
    draw_metallic_face(img, size)

    # Draw forehead gem
    draw_forehead_gem(img, size)

    # Draw luminous eyes
    draw_luminous_eyes(img, size)

    # Add face details
    add_face_details(img, size)

    # Add eye glow effect
    img = add_eye_glow(img, size)

    # Enhance contrast and sharpness
    if size >= 256:
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.08)
        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(1.15)

    return img.convert('RGB')


def generate_all_sizes(output_dir):
    """Generate all required iOS icon sizes."""
    sizes = {
        'AppIcon-1024.png': 1024,
        'AppIcon-180.png': 180,
        'AppIcon-120.png': 120,
        'AppIcon-167.png': 167,
        'AppIcon-152.png': 152,
        'AppIcon-76.png': 76,
        'AppIcon-87.png': 87,
        'AppIcon-80.png': 80,
        'AppIcon-60.png': 60,
        'AppIcon-40.png': 40,
    }

    os.makedirs(output_dir, exist_ok=True)

    print("Generating master icon at 1024x1024...")
    master = generate_icon(1024)

    for filename, size in sizes.items():
        print(f"  Generating {filename} ({size}x{size})...")
        if size == 1024:
            icon = master
        else:
            icon = master.resize((size, size), Image.Resampling.LANCZOS)

        filepath = os.path.join(output_dir, filename)
        icon.save(filepath, 'PNG', optimize=True)

    print(f"\nGenerated {len(sizes)} icon files in {output_dir}")
    return list(sizes.keys())


def generate_contents_json(filenames, output_dir):
    """Generate Contents.json for Xcode asset catalog."""
    specs = [
        ('AppIcon-40.png', '20x20', '2x', 'iphone'),
        ('AppIcon-60.png', '20x20', '3x', 'iphone'),
        ('AppIcon-60.png', '29x29', '2x', 'iphone'),
        ('AppIcon-87.png', '29x29', '3x', 'iphone'),
        ('AppIcon-80.png', '40x40', '2x', 'iphone'),
        ('AppIcon-120.png', '40x40', '3x', 'iphone'),
        ('AppIcon-120.png', '60x60', '2x', 'iphone'),
        ('AppIcon-180.png', '60x60', '3x', 'iphone'),
        ('AppIcon-40.png', '20x20', '1x', 'ipad'),
        ('AppIcon-40.png', '20x20', '2x', 'ipad'),
        ('AppIcon-60.png', '29x29', '1x', 'ipad'),
        ('AppIcon-60.png', '29x29', '2x', 'ipad'),
        ('AppIcon-40.png', '40x40', '1x', 'ipad'),
        ('AppIcon-80.png', '40x40', '2x', 'ipad'),
        ('AppIcon-76.png', '76x76', '1x', 'ipad'),
        ('AppIcon-152.png', '76x76', '2x', 'ipad'),
        ('AppIcon-167.png', '83.5x83.5', '2x', 'ipad'),
        ('AppIcon-1024.png', '1024x1024', '1x', 'ios-marketing'),
    ]

    images = [{'filename': f, 'idiom': idiom, 'scale': scale, 'size': s}
              for f, s, scale, idiom in specs]

    contents = {
        'images': images,
        'info': {'author': 'xcode', 'version': 1}
    }

    filepath = os.path.join(output_dir, 'Contents.json')
    with open(filepath, 'w') as f:
        json.dump(contents, f, indent=2)

    print("Generated Contents.json")


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    output_dir = os.path.join(project_root, 'ios', 'Adjutant', 'Resources',
                              'Assets.xcassets', 'AppIcon.appiconset')

    print("Generating SC2 Adjutant-inspired iOS app icon v3...")
    print(f"Output directory: {output_dir}\n")

    filenames = generate_all_sizes(output_dir)
    generate_contents_json(filenames, output_dir)

    print("\nDone! Icon generation complete.")


if __name__ == '__main__':
    main()
