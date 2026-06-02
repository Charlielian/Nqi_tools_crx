/**
 * 生成扩展图标文件
 * 运行: node generate-icons.js
 */
const fs = require('fs');
const path = require('path');

// 简单的 PNG 文件生成器（不使用外部库）
// 这会创建纯色背景的 PNG 图标

function createPNG(width, height, r, g, b) {
    // PNG 文件头
    const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);   // 宽度
    ihdrData.writeUInt32BE(height, 4);  // 高度
    ihdrData.writeUInt8(8, 8);          // 颜色深度
    ihdrData.writeUInt8(2, 9);          // 颜色类型 (RGB)
    ihdrData.writeUInt8(0, 10);         // 压缩方法
    ihdrData.writeUInt8(0, 11);         // 过滤器
    ihdrData.writeUInt8(0, 12);         // 交错方法

    const ihdr = createChunk('IHDR', ihdrData);

    // IDAT chunk - 未压缩的图像数据 (使用 zlib)
    const rawData = [];
    for (let y = 0; y < height; y++) {
        rawData.push(0); // 过滤器字节
        for (let x = 0; x < width; x++) {
            // 创建一个简单的渐变效果
            const centerX = width / 2;
            const centerY = height / 2;
            const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
            const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
            const factor = 1 - (dist / maxDist) * 0.3;

            rawData.push(Math.min(255, Math.floor(r * factor)));
            rawData.push(Math.min(255, Math.floor(g * factor)));
            rawData.push(Math.min(255, Math.floor(b * factor)));
        }
    }

    const zlib = require('zlib');
    const compressed = zlib.deflateSync(Buffer.from(rawData));
    const idat = createChunk('IDAT', compressed);

    // IEND chunk
    const iend = createChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const typeBuffer = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeBuffer, data]);

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);

    return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 计算
function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = [];

    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }

    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 生成图标
const iconsDir = __dirname;
const sizes = [16, 32, 48, 128];
const color = { r: 41, g: 128, b: 185 }; // 蓝色

console.log('正在生成图标...');

for (const size of sizes) {
    const filename = path.join(iconsDir, `icon${size}.png`);
    const png = createPNG(size, size, color.r, color.g, color.b);
    fs.writeFileSync(filename, png);
    console.log(`  ✓ 已生成 icon${size}.png`);
}

console.log('\n图标生成完成！');
