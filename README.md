# LabEdu Grader API

Backend API สำหรับระบบฝึกทำโจทย์และแข่งขันเขียนโปรแกรม C++/Python พัฒนาด้วย NestJS, Prisma และ MySQL โดยส่งโค้ดไปประมวลผลที่ self-hosted [Piston](https://github.com/engineer-man/piston) ตาม protocol เดียวกับโปรเจกต์ `api-SC-Exam`

## ความสามารถ

- Google Account sign-in โดยตรวจ Google ID token ที่ backend แล้วออก JWT ของระบบ
- 2 roles: `ADMIN` และ `USER`
- Admin สร้างโจทย์ ตั้งภาษา คะแนนเต็ม, time limit และ memory limit
- อัปโหลด test case เป็นคู่ไฟล์ `.in` และ `.sol` (เก็บเนื้อหาใน MySQL และไม่เปิดเผย hidden cases)
- คะแนนแต่ละ test case ปรับได้ และผลรวมต้องเท่าคะแนนเต็มก่อน publish
- ส่งคำตอบเข้าคิว ตัดสินด้วย Piston และเก็บผลราย test case
- การแข่งขันแบบกำหนดช่วงเวลา, สมัครเข้าร่วม, กำหนดน้ำหนักคะแนนรายโจทย์ และ leaderboard
- Leaderboard เรียงตามคะแนนรวม, เวลาที่ทำสำเร็จ, CPU time และ memory ตามลำดับ
- Playground สำหรับรัน C++/Python ด้วย stdin โดย Admin เปิดหรือปิดระบบจากฐานข้อมูลได้
- Swagger UI ที่ `/api/docs`

## เริ่มใช้งาน

ต้องมี Node.js 22-24, Docker (ถ้าจะใช้ MySQL จาก compose) และ Piston server ที่ติดตั้ง runtime C++/Python แล้ว

```bash
cp .env.example .env
docker compose up -d mysql
npm install
npm run db:generate
npm run db:migrate -- --name init
npm run start:dev
```

สำหรับ workspace นี้สามารถใช้ `npm run setup:local` เพื่อสร้าง `.env` ใหม่โดยนำเฉพาะการเชื่อมต่อ MySQL และ Piston จาก `../api-SC-Exam/.env` มาใช้ พร้อมเปลี่ยนเป็นฐาน `labedu_grader` และสร้าง JWT secret ใหม่ คำสั่งนี้จะไม่เขียนทับ `.env` ที่มีอยู่

API เริ่มต้นที่ `http://localhost:3100/api` และ Swagger อยู่ที่ `http://localhost:3100/api/docs`

ตั้ง `GOOGLE_CLIENT_ID` เป็น OAuth 2.0 Web Client ID เดียวกับ frontend จาก Google Cloud Console จากนั้น frontend ส่ง credential ที่ได้จาก Google Identity Services มาเป็น:

สร้าง Client ID ที่ Google Cloud Console → Google Auth Platform → Clients → Create client → **Web application** โดยเพิ่ม **Authorized JavaScript origins** ของหน้าเว็บที่ผู้ใช้กด Login เช่น `http://localhost:5173` สำหรับ development และ HTTPS origin จริงของเว็บ Grader เมื่อ deploy (ระบุเฉพาะ scheme + host + port ถ้ามี; ไม่ใส่ path) หาก frontend รับ credential ผ่าน JavaScript callback แล้วส่งให้ API ตามตัวอย่างด้านล่าง ไม่ต้องเพิ่ม `/api/auth/google` เป็น Authorized redirect URI ใส่ Client ID เดียวกันทั้ง frontend และ `GOOGLE_CLIENT_ID` ใน `.env` ของ API จากนั้นกำหนด `ADMIN_EMAILS` เป็นอีเมล Google ของผู้ดูแลจริง

```http
POST /api/auth/google
Content-Type: application/json

{"idToken":"<google-id-token>"}
```

กำหนดอีเมลผู้ดูแลเริ่มต้นใน `ADMIN_EMAILS` (คั่นด้วย comma) อีเมลเหล่านี้จะได้ role `ADMIN` เมื่อ Google sign-in ครั้งแรก หรือใช้ `SEED_ADMIN_EMAIL` และ `SEED_ADMIN_GOOGLE_SUB` กับ `npm run db:seed`

## เส้นทาง API สำคัญ

| Method | Path | Role | หน้าที่ |
|---|---|---|---|
| POST | `/api/auth/google` | Public | Google sign-in |
| GET | `/api/auth/me` | Any | ข้อมูลผู้ใช้ปัจจุบัน |
| GET | `/api/problems` | Any | รายการโจทย์ (Admin เห็น draft ด้วย) |
| POST | `/api/problems` | Admin | สร้างโจทย์ |
| POST | `/api/problems/:id/test-cases` | Admin | อัปโหลด `inputFile`, `solutionFile` พร้อม name, position, score, isSample |
| PATCH | `/api/problems/:id/status` | Admin | publish/archive โจทย์ |
| POST | `/api/submissions` | User/Admin | ส่ง source code; ระบุ competitionId เมื่อลงแข่ง |
| GET | `/api/submissions/:id` | เจ้าของ/Admin | ติดตามผลตัดสิน |
| POST | `/api/competitions` | Admin | สร้างการแข่งขัน |
| PATCH | `/api/competitions/:id/status` | Admin | เปิด/ปิดการแข่งขัน |
| POST | `/api/competitions/:id/join` | Any | สมัครการแข่งขัน |
| POST | `/api/problems/:id/test-cases/zip` | Admin | นำเข้า ZIP หลายคู่ .in / .sol เข้า subtask |
| POST | `/api/problems/:id/subtasks` | Admin | เพิ่มกลุ่มทดสอบ |
| PATCH | `/api/problems/:id/subtasks/:subtaskId` | Admin | แก้ไขกลุ่มทดสอบ |
| DELETE | `/api/problems/:id/subtasks/:subtaskId` | Admin | ลบกลุ่มที่ไม่มีเทส |
| PATCH | `/api/problems/:id/test-cases/:testCaseId` | Admin | ย้ายเทสเข้ากลุ่มหรือกำหนดคะแนนรายเทส |
| GET | `/api/competitions/:id/leaderboard` | Any | ตารางคะแนน |
| GET | `/api/settings` | Any | อ่านสถานะฟีเจอร์ส่วนกลาง |
| PATCH | `/api/settings` | Admin | เปิดหรือปิด Playground |
| POST | `/api/playground/run` | User/Admin | รันโค้ดใน Playground (เมื่อเปิดใช้งาน) |

ตัวอย่างสร้างโจทย์:

```json
{
  "slug": "a-plus-b",
  "title": "A + B",
  "statement": "รับจำนวนเต็ม A และ B แล้วแสดงผลรวม",
  "inputDescription": "A B",
  "outputDescription": "A + B",
  "difficulty": 1,
  "allowedLanguages": ["CPP", "PYTHON"],
  "timeLimitMs": 1000,
  "memoryLimitMb": 128,
  "maxScore": 100
}
```

ตัวอย่างอัปโหลด test case:

```bash
curl -X POST http://localhost:3100/api/problems/PROBLEM_ID/test-cases \
  -H "Authorization: Bearer TOKEN" \
  -F "name=case 1" -F "position=1" -F "score=50" -F "isSample=true" \
  -F "inputFile=@case1.in" -F "solutionFile=@case1.sol"
```

## Execution flow

1. API ตรวจสิทธิ์, สถานะโจทย์, ภาษาที่อนุญาต และช่วงเวลาการแข่งขัน
2. สร้าง submission เป็น `QUEUED` และตอบกลับทันที
3. worker ภายใน process เปลี่ยนเป็น `JUDGING` และส่งแต่ละ test case ไป Piston โดยไม่เปิด Piston ให้ browser เรียกตรง
4. จำกัดจำนวนงานพร้อมกันด้วย `RUNNER_MAX_CONCURRENCY`
5. บันทึกคะแนน, CPU time, peak memory และสถานะสุดท้าย ผู้เรียนดู actual output ได้เฉพาะ sample cases

หากจะรองรับผู้ใช้จำนวนมาก ควรแยก judge worker ออกจาก API และใช้ Redis/BullMQ หรือ message broker; schema ปัจจุบันแยก submission/result ไว้พร้อมต่อยอดแล้ว

## ตรวจสอบโค้ด

```bash
npm run build
npm test
```

## Deploy ไปยัง Plesk

โปรเจกต์มี GitHub Actions สำหรับตรวจสอบและ deploy เมื่อ push เข้า `main`
ดูขั้นตอนตั้งค่า Plesk, SSH key และ GitHub secrets ที่
[`PLESK_DEPLOYMENT.md`](./PLESK_DEPLOYMENT.md)

## Subtask scoring

Migration `20261007050000_add_subtasks` เพิ่มตาราง Subtask, TestCase.subtaskId และ Submission.subtaskResults แบบ nullable โดยไม่เปลี่ยนคะแนนหรือเทสเดิม รัน `npm run db:deploy` และ `npm run db:generate` ก่อน build/start backend รุ่นนี้

สร้างกลุ่มด้วย `{ "name": "ข้อมูลเล็ก", "description": "n ≤ 100", "score": 20, "position": 1 }` ที่ `POST /api/problems/:id/subtasks` ใช้ payload เดียวกันเมื่อ PATCH อัปโหลดเทสด้วย multipart `subtaskId=GROUP_ID` และ `score=0` หรือย้ายเทสด้วย PATCH `{ "subtaskId": "GROUP_ID", "score": 0 }` เมื่อต้องการคะแนนรายเทสให้ส่ง `subtaskId` เป็น string ว่างและกำหนด `score` (0 สำหรับตัวอย่างที่ไม่ให้คะแนน)

กลุ่มให้คะแนนครั้งเดียวเมื่อทุกเทสผ่าน คะแนนรายเทสภายในกลุ่มเป็น 0 ทุกกลุ่มต้องมีสมาชิกก่อนเผยแพร่ และคะแนนกลุ่มรวมกับคะแนนเทสที่ไม่อยู่ในกลุ่มต้องเท่ากับ maxScore ข้อความ description อธิบายขนาด/เงื่อนไขของข้อมูล ผู้ดูแลต้องเตรียมเทสให้ตรงกับข้อความนี้เอง ใช้ timeLimitMs / memoryLimitMb ของโจทย์กับทุกเทส

แก้กลุ่มและการจัดเทสได้เฉพาะฉบับร่างที่ไม่มี submission แล้วเท่านั้น ไม่ย้ายคำตอบเดิมเข้าเกณฑ์ใหม่ ผลกลุ่มถูกเก็บเป็น snapshot ใน submission: คะแนนเต็ม คะแนนที่ได้ สถานะ จำนวนผ่าน/ทั้งหมด เวลารวม และ peak memory ค่าที่ runner ไม่รายงานแสดงเป็น null การตรวจดำเนินต่อหลัง timeout / runtime / memory error เพื่อวัดกลุ่มอื่น แต่หยุดเมื่อ compile error ระบบยังซ่อน input/output ของเทสลับตามเดิม

Leaderboard ใช้คะแนนรวมจากกลุ่มและคะแนนรายเทสตามน้ำหนักการแข่งขัน แล้วเรียงคะแนนมากที่สุด เวลาโปรแกรมรวมน้อยที่สุด และผลรวม peak memory ของแต่ละโจทย์น้อยที่สุด ไม่ใช้เวลาส่งเป็นเกณฑ์ Subtask ไม่ได้คำนวณ Big O อัตโนมัติ

### Bulk ZIP import

`POST /api/problems/:id/test-cases/zip` รับ multipart `subtaskId` และ `zipFile` เฉพาะ Admin และใช้กฎ scoringEditable เดียวกับ subtask จับคู่ `.in` / `.sol` ชื่อเดียวกันและโฟลเดอร์เดียวกัน (ไม่แยกตัวพิมพ์เล็ก/ใหญ่) รองรับโฟลเดอร์ย่อยและข้าม metadata ของ macOS เรียงชื่อแบบตัวเลข ต่อ position จากลำดับสูงสุด แล้วนำเข้าทุกเทสเป็น `isSample=false`, `score=0` คืน `{ count, subtaskId, startPosition }`

ตรวจทุกคู่และ checksum ก่อนบันทึกใน transaction เดียว ปฏิเสธชื่อซ้ำ คู่ไม่ครบ ไฟล์ไม่ใช่ UTF-8 ไฟล์นอกสกุล .in/.sol ZIP เสียหาย มีรหัสผ่าน หรือ symbolic link จำกัด ZIP 20 MB, แต่ละไฟล์หลังแตก 2 MB, รวมหลังแตก 50 MB และ 500 คู่ ไม่เขียนไฟล์ที่แตกลง disk ไม่ต้องเพิ่ม migration ใหม่ ติดตั้ง dependency ด้วย `npm ci` ตาม lockfile และตั้ง reverse proxy ให้รับ multipart ได้ เช่น `client_max_body_size 25m;`

ตัวอย่าง:

```bash
curl -X POST http://localhost:3100/api/problems/PROBLEM_ID/test-cases/zip \
  -H "Authorization: Bearer TOKEN" \
  -F "subtaskId=SUBTASK_ID" -F "zipFile=@test-cases.zip"
```
