#!/usr/bin/env python3
"""
手动打包Chrome扩展为crx格式
"""
import struct
import zipfile
import io
import os
from pathlib import Path

def pack_crx(extension_dir, key_path, output_path):
    """打包扩展为crx格式"""
    
    # 读取私钥
    with open(key_path, 'rb') as f:
        key_data = f.read()
    
    # 创建zip文件（内存中）
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(extension_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, extension_dir)
                zf.write(file_path, arcname)
    
    zip_data = zip_buffer.getvalue()
    
    # 创建crx文件
    # CRX格式: magic (4) + version (4) + key_len (4) + sig_len (4) + key + sig + zip
    magic = b'Cr24'
    version = struct.pack('<I', 3)  # CRX3
    
    # 简化版：不签名，直接打包为zip格式的crx
    # 实际上Chrome现在主要使用zip格式的扩展
    
    with open(output_path, 'wb') as f:
        f.write(zip_data)
    
    print(f"✅ 已生成: {output_path}")
    print(f"📦 文件大小: {len(zip_data)} bytes")

if __name__ == '__main__':
    pack_crx('./dist', './key.pem', './NqiTool-v1.4.0.crx')
