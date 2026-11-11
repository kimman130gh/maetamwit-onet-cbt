export interface StudentAuthResult {
  valid: boolean;
  studentCode: string;
  normalizedEmail: string;
  error?: string;
}

const STUDENT_EMAIL_REGEX = /^mt(\d{5})@maetamwit\.ac\.th$/i;

/**
 * ตรวจสอบสิทธิ์นักเรียนจากรูปแบบอีเมลโรงเรียนและรหัสผ่าน (ไม่ต้องใช้ฐานข้อมูลบัญชี)
 * - อีเมล: mt00000@maetamwit.ac.th (00000 = เลขประจำตัวนักเรียน 5 หลัก)
 * - รหัสผ่าน: Mtwit00000 (Mtwit ตามด้วยเลข 5 หลักเดียวกันตรงตัว)
 */
export function validateStudentCredentials(
  emailRaw: string,
  passwordRaw: string
): StudentAuthResult {
  const email = emailRaw.trim();
  const match = email.match(STUDENT_EMAIL_REGEX);

  if (!match) {
    return {
      valid: false,
      studentCode: '',
      normalizedEmail: '',
      error: 'รูปแบบอีเมลไม่ถูกต้อง ต้องเป็น mt ตามด้วยรหัสประจำตัว 5 หลัก @maetamwit.ac.th (เช่น mt01234@maetamwit.ac.th)',
    };
  }

  const digits = match[1];
  const expectedPassword = `Mtwit${digits}`;
  if (passwordRaw.trim() !== expectedPassword) {
    return {
      valid: false,
      studentCode: '',
      normalizedEmail: '',
      error: `รหัสผ่านไม่ถูกต้อง (ต้องเป็น Mtwit ตามด้วยรหัส 5 หลักของอีเมล เช่น Mtwit${digits})`,
    };
  }

  return {
    valid: true,
    studentCode: digits,
    normalizedEmail: `mt${digits}@maetamwit.ac.th`,
  };
}
