use png::Encoder;
use std::{io::Cursor, num::Wrapping};
use tiny_skia::Pixmap;

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
    let mut pixmap = Pixmap::new(size, size).unwrap();
    let palette = generate_palette(seed, palette_nonce, colors.max(1));
    let mut rnd_val = seed ^ nonce;

    // Access the underlying pixel data (RGBA, each pixel is 4 bytes)
    let pixel_data = pixmap.data_mut();
    let alpha = 255;

    // Generate pixels for one half of the image and mirror it for symmetry
    for y in 0..(size / 2) {
        for x in 0..(size / 2) {
            rnd_val = xorshift64(rnd_val);
            let (r, g, b) = palette[rnd_val as usize % palette.len()].clone();

            // Calculate index in RGBA array (4 bytes per pixel)
            let index = ((y * size + x) * 4) as usize;
            let mirrored_x_index = ((y * size + (size - x - 1)) * 4) as usize;
            let mirrored_y_index = (((size - y - 1) * size + x) * 4) as usize;
            let mirrored_xy_index = (((size - y - 1) * size + (size - x - 1)) * 4) as usize;

            // Set the color pixel (R, G, B, A)
            pixel_data[index..index + 4].copy_from_slice(&[r, g, b, alpha]);

            // Mirror pixels
            pixel_data[mirrored_x_index..mirrored_x_index + 4].copy_from_slice(&[r, g, b, alpha]);
            pixel_data[mirrored_y_index..mirrored_y_index + 4].copy_from_slice(&[r, g, b, alpha]);
            pixel_data[mirrored_xy_index..mirrored_xy_index + 4].copy_from_slice(&[r, g, b, alpha]);
        }
    }

    let final_pixmap = scale_pixmap(&pixmap, scale);

    let mut buffer = Vec::new();
    {
        let scaled_size = size * scale;
        let mut encoder = Encoder::new(Cursor::new(&mut buffer), scaled_size, scaled_size);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);

        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&final_pixmap.data()).unwrap();
    }

    buffer
}

fn scale_pixmap(pixmap: &Pixmap, factor: u32) -> Pixmap {
    let (orig_width, orig_height) = (pixmap.width(), pixmap.height());
    let (new_width, new_height) = (orig_width * factor, orig_height * factor);

    // Create a new Pixmap with the scaled size
    let mut scaled_pixmap = Pixmap::new(new_width, new_height).unwrap();

    // Get the original pixmap data (RGBA channels, 4 bytes per pixel)
    let original_data = pixmap.data();
    let scaled_data = scaled_pixmap.data_mut();

    // Iterate through each pixel in the original pixmap
    for y in 0..orig_height {
        for x in 0..orig_width {
            // Get the RGBA color data of the current pixel (4 bytes per pixel)
            let pixel_offset = ((y * orig_width + x) * 4) as usize;
            let rgba = &original_data[pixel_offset..pixel_offset + 4];

            // Scale the current pixel into a factor x factor block in the new pixmap
            for dy in 0..factor {
                for dx in 0..factor {
                    let new_x = x * factor + dx;
                    let new_y = y * factor + dy;
                    let new_pixel_offset = ((new_y * new_width + new_x) * 4) as usize;

                    // Copy the RGBA values to the new scaled location
                    scaled_data[new_pixel_offset..new_pixel_offset + 4].copy_from_slice(rgba);
                }
            }
        }
    }

    scaled_pixmap
}

fn xorshift64(seed: u64) -> u64 {
    let mut state = seed;
    state ^= state >> 12;
    state ^= state << 25;
    state ^= state >> 27;
    (Wrapping(state) * Wrapping(0x2545F4914F6CDD1D)).0
}
