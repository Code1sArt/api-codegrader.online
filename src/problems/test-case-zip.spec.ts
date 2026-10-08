import { readTestCaseZip, ZIP_MAX_BYTES } from './test-case-zip';
import { testZip } from './test-zip.fixture';

describe('test case ZIP parsing', () => {
  it('matches pairs by full path, sorts naturally and supports uppercase extensions and empty output', async () => {
    expect(await readTestCaseZip(testZip([['cases/10.in', '10'], ['cases/2.IN', '\uFEFF2'], ['cases/2.SOL', ''], ['cases/10.sol', '10'], ['__MACOSX/._junk', 'metadata'], ['.DS_Store', 'metadata']]))).toEqual([
      { name: 'cases/2', input: '2', expectedOutput: '' }, { name: 'cases/10', input: '10', expectedOutput: '10' },
    ]);
  });
  it('rejects an incomplete pair instead of accepting the other valid pairs', async () => {
    await expect(readTestCaseZip(testZip([['1.in', '1'], ['1.sol', '1'], ['2.in', '2']]))).rejects.toThrow('ต้องมีไฟล์ .in และ .sol');
  });
  it('does not match files from different folders', async () => {
    await expect(readTestCaseZip(testZip([['a/1.in', '1'], ['b/1.sol', '1']]))).rejects.toThrow('โฟลเดอร์เดียวกัน');
  });
  it('rejects duplicate names ignoring case', async () => {
    await expect(readTestCaseZip(testZip([['1.in', '1'], ['1.IN', '2'], ['1.sol', '1']]))).rejects.toThrow('ไฟล์ชื่อซ้ำ');
  });
  it('rejects empty archives, invalid UTF-8 and unexpected file extensions', async () => {
    await expect(readTestCaseZip(testZip([]))).rejects.toThrow('ไม่พบคู่ไฟล์');
    await expect(readTestCaseZip(testZip([['1.in', Buffer.from([0xff])], ['1.sol', '1']]))).rejects.toThrow('UTF-8');
    await expect(readTestCaseZip(testZip([['1.exe', '1']]))).rejects.toThrow('ต้องเป็น .in หรือ .sol');
  });
  it('rejects corrupt archives and traversal paths', async () => {
    await expect(readTestCaseZip(Buffer.from('not zip'))).rejects.toThrow('อ่าน ZIP ไม่ได้');
    await expect(readTestCaseZip(testZip([['../1.in', '1'], ['../1.sol', '1']]))).rejects.toThrow();
  });
  it('limits compressed uploads and expanded entry sizes', async () => {
    await expect(readTestCaseZip(Buffer.alloc(ZIP_MAX_BYTES + 1))).rejects.toThrow('20 MB');
    await expect(readTestCaseZip(testZip([['1.in', Buffer.alloc(2 * 1024 * 1024 + 1)], ['1.sol', '1']]))).rejects.toThrow('2 MB');
  });
  it('checks checksums and rejects encrypted entries', async () => {
    const corrupt = testZip([['1.in', '1'], ['1.sol', '1']]);
    const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    corrupt.writeUInt32LE(0, central + 16);
    await expect(readTestCaseZip(corrupt)).rejects.toThrow('เสียหาย');
    const encrypted = testZip([['1.in', '1'], ['1.sol', '1']]);
    const encryptedCentral = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(0x801, encryptedCentral + 8);
    await expect(readTestCaseZip(encrypted)).rejects.toThrow('รหัสผ่าน');
  });
  it('limits the combined expanded size even when the ZIP compresses very small', async () => {
    const files: [string, Buffer][] = [];
    for (let i = 0; i < 26; i++) files.push([`${i}.in`, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(readTestCaseZip(testZip(files))).rejects.toThrow('50 MB');
  });
  it('limits total pairs', async () => {
    const files: [string, string][] = [];
    for (let i = 0; i < 501; i++) files.push([`${i}.in`, ''], [`${i}.sol`, '']);
    await expect(readTestCaseZip(testZip(files))).rejects.toThrow('500 เทส');
  });
});
