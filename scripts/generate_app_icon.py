#!/usr/bin/env python3
"""
Generate SC2 Adjutant-inspired iOS app icon.

Design: Stylized humanoid android face with:
- Dark background (#0A0A0A, #1A1A1A)
- Glowing green eyes (CRT phosphor green #00FF00, #00FF88)
- Purple accent highlights (#8B5CF6, #A855F7)
- Geometric, angular features
- Subtle circuit board pattern
"""

import os
import sys
import math
import json

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

# Color palette
BLACK_PRIMARY = (10, 10, 10)        # #0A0A0A
BLACK_SECONDARY = (26, 26, 26)      # #1A1A1A
DARK_GRAY = (40, 40, 45)            # Face plates
MID_GRAY = (60, 60, 70)             # Face highlights
GREEN_PRIMARY = (0, 255, 0)         # #00FF00 - CRT phosphor
GREEN_SECONDARY = (0, 255, 136)     # #00FF88 - Softer green
GREEN_GLOW = (0, 200, 50)           # Glow effect
GREEN_DIM = (0, 80, 30)             # Dim green for circuits
PURPLE_PRIMARY = (139, 92, 246)     # #8B5CF6
PURPLE_SECONDARY = (168, 85, 247)   # #A855F7


def draw_circuit_pattern(draw, size, density=0.015):
    """Draw subtle circuit board pattern on background."""
    import random
    random.seed(42)  # Consistent pattern

    # Horizontal and vertical traces
    for _ in range(int(size * density)):
        x = random.randint(0, size)
        y = random.randint(0, size)

        # Draw trace
        length = random.randint(size // 20, size // 5)
        direction = random.choice(['h', 'v'])

        if direction == 'h':
            draw.line([(x, y), (x + length, y)], fill=GREEN_DIM, width=1)
        else:
            draw.line([(x, y), (x, y + length)], fill=GREEN_DIM, width=1)

        # Small node at start
        if random.random() > 0.5:
            node_size = 2
            draw.ellipse([x - node_size, y - node_size, x + node_size, y + node_size],
                        fill=GREEN_DIM)


def draw_android_face(img, size):
    """Draw stylized android face."""
    draw = ImageDraw.Draw(img)
    center_x = size // 2
    center_y = size // 2

    # Face dimensions (relative to size)
    face_width = int(size * 0.65)
    face_height = int(size * 0.75)

    # Draw angular face shape - hexagonal/diamond inspired
    face_top = center_y - face_height // 2 + int(size * 0.05)
    face_bottom = center_y + face_height // 2
    face_left = center_x - face_width // 2
    face_right = center_x + face_width // 2

    # Angular face polygon (stylized helmet/face plate)
    chin_y = face_bottom - int(size * 0.05)
    chin_width = int(face_width * 0.25)
    forehead_y = face_top + int(size * 0.12)

    face_points = [
        (center_x, face_top),  # Top center
        (face_right - int(size * 0.05), forehead_y),  # Top right
        (face_right, center_y - int(size * 0.05)),  # Right upper
        (face_right - int(size * 0.03), center_y + int(size * 0.15)),  # Right lower
        (center_x + chin_width, chin_y),  # Chin right
        (center_x, face_bottom),  # Chin bottom
        (center_x - chin_width, chin_y),  # Chin left
        (face_left + int(size * 0.03), center_y + int(size * 0.15)),  # Left lower
        (face_left, center_y - int(size * 0.05)),  # Left upper
        (face_left + int(size * 0.05), forehead_y),  # Top left
    ]

    # Draw face with gradient effect (darker edges, lighter center)
    draw.polygon(face_points, fill=DARK_GRAY)

    # Inner face plate (lighter)
    inner_scale = 0.85
    inner_points = []
    for px, py in face_points:
        dx = px - center_x
        dy = py - center_y
        inner_points.append((center_x + dx * inner_scale, center_y + dy * inner_scale))
    draw.polygon(inner_points, fill=MID_GRAY)

    # Central face line (vertical divider)
    line_y_start = face_top + int(size * 0.15)
    line_y_end = chin_y - int(size * 0.05)
    draw.line([(center_x, line_y_start), (center_x, line_y_end)],
              fill=(80, 80, 90), width=max(2, size // 200))

    # Forehead accent (purple gem/indicator)
    gem_y = face_top + int(size * 0.18)
    gem_size = int(size * 0.045)
    gem_points = [
        (center_x, gem_y - gem_size),  # Top
        (center_x + gem_size, gem_y),  # Right
        (center_x, gem_y + gem_size),  # Bottom
        (center_x - gem_size, gem_y),  # Left
    ]
    draw.polygon(gem_points, fill=PURPLE_PRIMARY)

    # Gem highlight
    gem_highlight_size = gem_size * 0.6
    gem_highlight = [
        (center_x, gem_y - gem_highlight_size),
        (center_x + gem_highlight_size * 0.6, gem_y - gem_highlight_size * 0.3),
        (center_x, gem_y),
        (center_x - gem_highlight_size * 0.6, gem_y - gem_highlight_size * 0.3),
    ]
    draw.polygon(gem_highlight, fill=PURPLE_SECONDARY)

    return draw


def draw_glowing_eyes(img, size):
    """Draw the signature glowing green eyes."""
    draw = ImageDraw.Draw(img)
    center_x = size // 2
    center_y = size // 2

    # Eye positions
    eye_y = center_y - int(size * 0.02)
    eye_spacing = int(size * 0.16)
    eye_width = int(size * 0.12)
    eye_height = int(size * 0.035)

    for eye_x in [center_x - eye_spacing, center_x + eye_spacing]:
        # Eye socket (dark recess)
        socket_margin = int(size * 0.015)
        draw.ellipse([
            eye_x - eye_width - socket_margin,
            eye_y - eye_height - socket_margin,
            eye_x + eye_width + socket_margin,
            eye_y + eye_height + socket_margin
        ], fill=(15, 15, 15))

        # Main eye shape (angular/almond)
        eye_points = [
            (eye_x - eye_width, eye_y),  # Left point
            (eye_x - eye_width * 0.5, eye_y - eye_height),  # Top left
            (eye_x + eye_width * 0.5, eye_y - eye_height),  # Top right
            (eye_x + eye_width, eye_y),  # Right point
            (eye_x + eye_width * 0.5, eye_y + eye_height),  # Bottom right
            (eye_x - eye_width * 0.5, eye_y + eye_height),  # Bottom left
        ]
        draw.polygon(eye_points, fill=GREEN_PRIMARY)

        # Bright center
        inner_width = eye_width * 0.5
        inner_height = eye_height * 0.6
        draw.ellipse([
            eye_x - inner_width,
            eye_y - inner_height,
            eye_x + inner_width,
            eye_y + inner_height
        ], fill=(200, 255, 200))

    return img


def add_glow_effect(img, size):
    """Add glow effect around the eyes."""
    # Create a glow layer
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)

    center_x = size // 2
    center_y = size // 2
    eye_y = center_y - int(size * 0.02)
    eye_spacing = int(size * 0.16)

    # Draw large soft circles for glow
    glow_radius = int(size * 0.08)
    for eye_x in [center_x - eye_spacing, center_x + eye_spacing]:
        for i in range(10, 0, -1):
            radius = glow_radius + i * (size // 100)
            alpha = int(30 * (i / 10))
            glow_draw.ellipse([
                eye_x - radius, eye_y - radius,
                eye_x + radius, eye_y + radius
            ], fill=(0, 255, 50, alpha))

    # Blur the glow
    glow = glow.filter(ImageFilter.GaussianBlur(radius=size // 30))

    # Composite glow under the main image
    result = Image.new('RGBA', (size, size), BLACK_PRIMARY)
    result.paste(glow, (0, 0), glow)

    # Convert main img to RGBA and composite
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Composite - we need to blend properly
    result = Image.alpha_composite(result, img)

    return result


def add_subtle_details(img, size):
    """Add subtle details like panel lines and accents."""
    draw = ImageDraw.Draw(img)
    center_x = size // 2
    center_y = size // 2

    # Cheek panel lines
    line_width = max(1, size // 400)

    # Left cheek
    cheek_x = center_x - int(size * 0.22)
    cheek_y = center_y + int(size * 0.08)
    draw.line([
        (cheek_x - int(size * 0.05), cheek_y),
        (cheek_x + int(size * 0.02), cheek_y + int(size * 0.1))
    ], fill=(50, 50, 55), width=line_width)

    # Right cheek (mirrored)
    cheek_x = center_x + int(size * 0.22)
    draw.line([
        (cheek_x + int(size * 0.05), cheek_y),
        (cheek_x - int(size * 0.02), cheek_y + int(size * 0.1))
    ], fill=(50, 50, 55), width=line_width)

    # Small status indicators below eyes
    indicator_y = center_y + int(size * 0.12)
    indicator_size = int(size * 0.012)

    for x_offset in [-0.08, 0.08]:
        ix = center_x + int(size * x_offset)
        draw.ellipse([
            ix - indicator_size, indicator_y - indicator_size,
            ix + indicator_size, indicator_y + indicator_size
        ], fill=GREEN_SECONDARY)

    return img


def generate_icon(size):
    """Generate the complete icon at specified size."""
    # Create base image with dark background
    img = Image.new('RGBA', (size, size), BLACK_PRIMARY)
    draw = ImageDraw.Draw(img)

    # Add subtle radial gradient background
    for i in range(size // 2, 0, -5):
        alpha = int(20 * (i / (size // 2)))
        color = (26, 26, 26, alpha)
        draw.ellipse([
            size // 2 - i, size // 2 - i,
            size // 2 + i, size // 2 + i
        ], fill=color)

    # Add circuit pattern (subtle)
    if size >= 256:
        draw_circuit_pattern(draw, size)

    # Draw the android face
    draw_android_face(img, size)

    # Draw glowing eyes
    draw_glowing_eyes(img, size)

    # Add subtle details
    add_subtle_details(img, size)

    # Add glow effect
    img = add_glow_effect(img, size)

    # Apply slight sharpening for crisp edges
    if size >= 256:
        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(1.2)

    return img.convert('RGB')


def generate_all_sizes(output_dir):
    """Generate all required iOS icon sizes."""
    # iOS icon sizes (actual pixel sizes, not points)
    sizes = {
        'AppIcon-1024.png': 1024,      # App Store
        'AppIcon-180.png': 180,        # iPhone @3x
        'AppIcon-120.png': 120,        # iPhone @2x
        'AppIcon-167.png': 167,        # iPad Pro @2x
        'AppIcon-152.png': 152,        # iPad @2x
        'AppIcon-76.png': 76,          # iPad @1x
        'AppIcon-87.png': 87,          # Spotlight @3x
        'AppIcon-80.png': 80,          # Spotlight @2x
        'AppIcon-60.png': 60,          # Notification @3x
        'AppIcon-40.png': 40,          # Notification @2x
    }

    os.makedirs(output_dir, exist_ok=True)

    # Generate master at 1024x1024
    print("Generating master icon at 1024x1024...")
    master = generate_icon(1024)

    for filename, size in sizes.items():
        print(f"  Generating {filename} ({size}x{size})...")
        if size == 1024:
            icon = master
        else:
            # High-quality downscale from master
            icon = master.resize((size, size), Image.Resampling.LANCZOS)

        filepath = os.path.join(output_dir, filename)
        icon.save(filepath, 'PNG', optimize=True)

    print(f"\nGenerated {len(sizes)} icon files in {output_dir}")
    return list(sizes.keys())


def generate_contents_json(filenames, output_dir):
    """Generate Contents.json for Xcode asset catalog."""
    images = []

    # Define the icon specifications
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

    for filename, size, scale, idiom in specs:
        images.append({
            'filename': filename,
            'idiom': idiom,
            'scale': scale,
            'size': size
        })

    contents = {
        'images': images,
        'info': {
            'author': 'xcode',
            'version': 1
        }
    }

    filepath = os.path.join(output_dir, 'Contents.json')
    with open(filepath, 'w') as f:
        json.dump(contents, f, indent=2)

    print(f"Generated Contents.json")


def main():
    # Output directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    output_dir = os.path.join(project_root, 'ios', 'Adjutant', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset')

    print(f"Generating SC2 Adjutant-inspired iOS app icons...")
    print(f"Output directory: {output_dir}\n")

    # Generate all icon sizes
    filenames = generate_all_sizes(output_dir)

    # Generate Contents.json
    generate_contents_json(filenames, output_dir)

    print("\nDone! Icon generation complete.")


if __name__ == '__main__':
    main()
