# ระบบสอบมาตรฐาน O-NET CBT (ม.1–ม.3) — GitHub Pages + Supabase Back-End Control

ระบบสอบออนไลน์มาตรฐาน O-NET สำหรับรายวิชา **การออกแบบและเทคโนโลยี & วิทยาการคำนวณ** (โรงเรียนแม่ต๋ำตาดควันวิทยาคม) พร้อม **ระบบอนุมัติข้อสอบหลังบ้าน (Back-End Approval Control)**:

- **คลังข้อสอบครบ 3 ระดับชั้น ขยาย 2 เท่า (1,080 ข้อ):** ม.1 (360 ข้อ), ม.2 (360 ข้อ), ม.3 (360 ข้อ) ตัวชี้วัดละ 40 ข้อ ครบทุกตัวชี้วัด `ว 4.1` และ `ว 4.2`
- **ชุดสอบพร้อมใช้ 54 ชุด:**
  - `P01_PRE`–`P10_PRE` : แบบทดสอบก่อนเรียน ม.2 (แผนที่ 1–10)
  - `P01_POST`–`P10_POST` : แบบทดสอบหลังเรียน ม.2 สุ่มข้อ-สลับตัวเลือก (แผนที่ 1–10)
  - `U01`–`U05` : แบบทดสอบท้ายหน่วยที่ 1–5 (สุ่ม 20 ข้อจากพูลหน่วย)
  - `MIDTERM` & `FINAL` : ข้อสอบกลางภาค (สุ่ม 40 ข้อ) และปลายภาค (สุ่ม 40 ข้อ) — ปิดดูเฉลยอัตโนมัติระหว่างสอบ
  - `IND_M1_*` / `IND_M2_*` / `IND_M3_*` : คลังสอบรายตัวชี้วัดครบทั้ง 27 ตัวชี้วัด (สุ่ม 10 จาก 40 ข้อ)
- **ระบบควบคุมความปลอดภัยฝั่ง Server:**
  - **การลงชื่อเข้าสอบของนักเรียน:** ตรวจสอบรูปแบบอีเมลโรงเรียน `mt00000@maetamwit.ac.th` (`00000` คือเลขประจำตัวนักเรียน 5 หลัก) คู่กับรหัสผ่าน `Mtwit00000` ทั้งฝั่ง Browser และ Edge Function โดย**ไม่ต้องสร้างฐานข้อมูลบัญชีนักเรียน** (และไม่บันทึกรหัสผ่านลงฐานข้อมูล)
  - **เริ่มต้นปิดสอบทั้งหมด (`approved = false`)** นักเรียนมองเห็นและเข้าสอบได้เฉพาะชุดที่ครูอนุมัติจากหลังบ้าน (`#/admin`) เท่านั้น
  - แยกตารางเฉลย `question_keys` และรหัสผ่านห้องสอบ `exam_secrets` ออกจากสิทธิ์ `anon` 100%
  - สุ่มโจทย์/ช้อยส์ และตรวจคะแนนฝั่ง Server ใน Supabase Edge Function (`supabase/functions/onet-exam/index.ts`)
  - อัปเดตสถานะสอบและการส่งคำตอบสดผ่าน **Supabase Realtime**

---

## ขั้นตอนนำขึ้น Supabase และ GitHub (เมื่อพร้อมสร้างโปรเจกต์จริง)

1. **สร้างโปรเจกต์ Supabase** (ในองค์กร `KimClassroomOrg` โซน `ap-southeast-1` สิงคโปร์)
2. **สร้างตารางและ RLS:** รันไฟล์ [202611110001_init_onet_schema.sql](supabase/migrations/202611110001_init_onet_schema.sql) จากนั้นนำเข้าไฟล์ `supabase/seed.sql` (คลัง 1,080 ข้อ + 54 ชุดสอบ — **สงวนสิทธิ์ไม่อัปโหลด `seed.sql` ขึ้น GitHub สาธารณะ** เพื่อรักษาความลับของตารางเฉลย `question_keys`)
3. **Deploy Edge Function `onet-exam`:** อัปโหลดไฟล์ [supabase/functions/onet-exam/index.ts](supabase/functions/onet-exam/index.ts)
4. **เพิ่มบัญชีครูผู้สอนใน Back-End:** สร้างผู้ใช้ใน Supabase **Authentication > Users** (เช่น `kimman130@maetamwit.ac.th`) แล้วรัน SQL:
   ```sql
   INSERT INTO public.teacher_admins (user_id, email)
   SELECT id, email FROM auth.users WHERE email = 'kimman130@maetamwit.ac.th';
   ```
5. **ทดสอบรันบนเครื่อง (Local Preview):**
   ```bash
   cp .env.example .env.local
   # แก้ไขใส่ VITE_SUPABASE_URL และ VITE_SUPABASE_PUBLISHABLE_KEY
   npm install
   npm run dev
   ```
6. **อัปขึ้น GitHub (`kimman130gh`) & เปิด GitHub Pages ฟรี:**
   - สร้าง Repository ใหม่บน GitHub แล้ว push โค้ดนี้ขึ้นสาขา `main`
   - ไปที่ GitHub Repo **Settings > Secrets and variables > Actions** เพิ่ม Secrets 2 ตัว:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - ไปที่ **Settings > Pages** เลือก Source = **GitHub Actions** ระบบจะ Build & Deploy ให้อัตโนมัติทันที
