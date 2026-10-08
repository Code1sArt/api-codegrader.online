import { crc32 } from 'node:zlib';
import { BadRequestException } from '@nestjs/common';
import { fromBufferPromise, type ZipFile } from 'yauzl';

export const ZIP_MAX_BYTES = 20 * 1024 * 1024;
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
const TOTAL_MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAIRS = 500;
export type ZipTestCase = { name: string; input: string; expectedOutput: string };

export async function readTestCaseZip(buffer: Buffer): Promise<ZipTestCase[]> {
  if (buffer.length > ZIP_MAX_BYTES) throw new BadRequestException('ZIP ต้องมีขนาดไม่เกิน 20 MB');
  let zip: ZipFile | undefined;
  try {
    zip = await fromBufferPromise(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
    if (zip.entryCount > 2000) throw new BadRequestException('ZIP มีรายการไฟล์มากเกินไป');
    const pairs = new Map<string, { name: string; input?: string; expectedOutput?: string }>();
    let total = 0;
    for await (const entry of zip.eachEntry()) {
      const path = entry.fileName;
      if (path.includes('\0') || path.startsWith('/') || path.split('/').includes('..')) {
        throw new BadRequestException('ชื่อไฟล์ใน ZIP ไม่ถูกต้อง');
      }
      if (path.endsWith('/') || path.startsWith('__MACOSX/') || path.split('/').at(-1) === '.DS_Store') continue;
      if (entry.isEncrypted()) throw new BadRequestException('ZIP ต้องไม่ตั้งรหัสผ่าน');
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new BadRequestException('ZIP ต้องไม่มี symbolic link');
      const match = /^(.*)\.(in|sol)$/i.exec(path);
      if (!match || !match[1] || match[1].endsWith('/')) throw new BadRequestException(`ไฟล์ ${path} ต้องเป็น .in หรือ .sol`);
      const name = match[1];
      if (name.length > 191) throw new BadRequestException(`ชื่อเทส ${name} ยาวเกิน 191 ตัวอักษร`);
      const key = name.toLowerCase();
      const pair = pairs.get(key) ?? { name };
      const field = match[2].toLowerCase() === 'in' ? 'input' : 'expectedOutput';
      if (pair[field] !== undefined) throw new BadRequestException(`ไฟล์ชื่อซ้ำ: ${path}`);
      if (entry.uncompressedSize > FILE_MAX_BYTES) throw new BadRequestException(`ไฟล์ ${path} หลังแตก ZIP ต้องไม่เกิน 10 MB`);
      total += entry.uncompressedSize;
      if (total > TOTAL_MAX_BYTES) throw new BadRequestException('ไฟล์ทั้งหมดหลังแตก ZIP ต้องไม่เกิน 50 MB');
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > FILE_MAX_BYTES) { stream.destroy(); throw new BadRequestException(`ไฟล์ ${path} หลังแตก ZIP ต้องไม่เกิน 10 MB`); }
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks);
      if (crc32(content) !== entry.crc32) throw new BadRequestException(`ไฟล์ ${path} ใน ZIP เสียหาย`);
      try { pair[field] = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^\uFEFF/, ''); }
      catch { throw new BadRequestException(`ไฟล์ ${path} ต้องเป็นข้อความ UTF-8`); }
      pairs.set(key, pair);
      if (pairs.size > MAX_PAIRS) throw new BadRequestException('เพิ่มได้ไม่เกิน 500 เทสต่อ ZIP');
    }
    if (!pairs.size) throw new BadRequestException('ไม่พบคู่ไฟล์ .in / .sol ใน ZIP');
    return [...pairs.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map((pair) => {
      if (pair.input === undefined || pair.expectedOutput === undefined) throw new BadRequestException(`เทส ${pair.name} ต้องมีไฟล์ .in และ .sol ชื่อเดียวกันในโฟลเดอร์เดียวกัน`);
      return { name: pair.name, input: pair.input, expectedOutput: pair.expectedOutput };
    });
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('อ่าน ZIP ไม่ได้ ไฟล์อาจเสียหายหรือใช้รูปแบบที่ไม่รองรับ');
  } finally { zip?.close(); }
}
