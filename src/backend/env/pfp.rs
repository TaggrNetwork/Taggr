use png::Encoder;
use std::{io::Cursor, num::Wrapping};

fn generate_palette(seed: u64, palette_nonce: u64, num_colors: u64) -> Vec<(u8, u8, u8)> {
    // Every odd palette is an inverse of the previous one.
    if palette_nonce % 2 == 1 {
        return generate_palette(seed, palette_nonce - 1, num_colors)
            .into_iter()
            .map(|(r, g, b)| (255 - r, 255 - g, 255 - b))
            .collect();
    }

    let color_seed = seed ^ palette_nonce;

    let r = xorshift64(color_seed) % 256;
    let g = xorshift64(xorshift64(color_seed)) % 256;
    let b = xorshift64(xorshift64(xorshift64(color_seed))) % 256;
    let base_color = (r, g, b);

    let mut colors = Vec::new();

    for i in 0..num_colors {
        // Slightly adjust the RGB values for variety
        let r = (base_color.0 + i * 30) % 256;
        let g = (base_color.1 + i * 30) % 256;
        let b = (base_color.2 + i * 30) % 256;

        colors.push((r as u8, g as u8, b as u8));
    }

    // Palette 0 makes the first two colors black and white. This way, by setting num_colors to 2,
    // the user can generate monochrome pfps.
    if palette_nonce == 0 {
        colors[0] = (0, 0, 0);
        if num_colors > 1 {
            colors[1] = (255, 255, 255);
        }
    }

    colors
}

pub fn pfp(user_id: u64, nonce: u64, palette_nonce: u64, colors: u64, scale: u32) -> Vec<u8> {
    let seed = u64::MAX - user_id;
    let size = 8;
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let palette = generate_palette(seed, palette_nonce, colors.max(1));
    let mut rnd_val = seed ^ nonce;

    // Generate pixels for one half of the image and mirror it for symmetry
    for y in 0..(size / 2) {
        for x in 0..(size / 2) {
            rnd_val = xorshift64(rnd_val);
            let (r, g, b) = palette[rnd_val as usize % palette.len()];
            let alpha = 255;

            // Set pixels in all four quadrants
            for &(px, py) in &[
                (x, y),
                (size - 1 - x, y),
                (x, size - 1 - y),
                (size - 1 - x, size - 1 - y),
            ] {
                let idx = ((py * size + px) * 4) as usize;
                pixels[idx..idx + 4].copy_from_slice(&[r, g, b, alpha]);
            }
        }
    }

    let scaled = scale_pixels(&pixels, size, size, scale);
    let mut buffer = Vec::new();
    {
        let scaled_size = size * scale;
        let mut encoder = Encoder::new(Cursor::new(&mut buffer), scaled_size, scaled_size);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);

        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&scaled).unwrap();
    }

    buffer
}

fn scale_pixels(pixels: &[u8], width: u32, height: u32, factor: u32) -> Vec<u8> {
    let new_width = width * factor;
    let new_height = height * factor;
    let mut scaled = vec![0u8; (new_width * new_height * 4) as usize];

    for y in 0..height {
        for x in 0..width {
            let src_idx = ((y * width + x) * 4) as usize;
            let rgba = &pixels[src_idx..src_idx + 4];

            for dy in 0..factor {
                for dx in 0..factor {
                    let new_x = x * factor + dx;
                    let new_y = y * factor + dy;
                    let dst_idx = ((new_y * new_width + new_x) * 4) as usize;
                    scaled[dst_idx..dst_idx + 4].copy_from_slice(rgba);
                }
            }
        }
    }

    scaled
}

fn xorshift64(seed: u64) -> u64 {
    let mut state = seed;
    state ^= state >> 12;
    state ^= state << 25;
    state ^= state >> 27;
    (Wrapping(state) * Wrapping(0x2545F4914F6CDD1D)).0
}
