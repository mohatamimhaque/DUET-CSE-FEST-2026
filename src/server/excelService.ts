import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { getSupabaseClient } from './supabase.ts';
import { supabaseRepository } from './supabaseRepository.ts';

export interface RawExcelRow {
  serial?: any;
  Serial?: any;
  SERIAL?: any;
  'student id'?: any;
  'Student ID'?: any;
  'student_id'?: any;
  'Student_ID'?: any;
  roll?: any;
  Roll?: any;
  id?: any;
  ID?: any;
  name?: any;
  Name?: any;
  NAME?: any;
  type?: any;
  Type?: any;
  TYPE?: any;
  designation?: any;
  Designation?: any;
  DESIGNATION?: any;
  department?: any;
  Department?: any;
  [key: string]: any;
}

export interface NormalizedParticipantRow {
  rowIndex: number;
  rawSerial: string;
  studentId: string;
  name: string;
  type: 'student' | 'faculty' | 'guest';
  designation: string;
  department: string;
  isValid: boolean;
  validationError?: string;
  validationWarning?: string;
}

export interface ExcelParseResult {
  fileName: string;
  fileSize: number;
  foundInRoot: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  counts: {
    students: number;
    faculty: number;
    guests: number;
  };
  rows: NormalizedParticipantRow[];
  headers: string[];
}

/**
 * Locate candidate Excel file in root folder.
 * Matches: data.excel, data.xlsx, data.xls
 */
export function findRootExcelFile(): { filePath: string; fileName: string } | null {
  const rootDir = process.cwd();
  const candidates = [
    'data.excel',
    'data.xlsx',
    'data.xls',
    'DATA.EXCEL',
    'DATA.XLSX',
    'DATA.XLS',
    'data.csv',
  ];

  for (const name of candidates) {
    const fullPath = path.join(rootDir, name);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && stat.size > 0) {
        return { filePath: fullPath, fileName: name };
      }
    }
  }

  // Check if any file in root starts with data and has excel or xls extension
  try {
    const files = fs.readdirSync(rootDir);
    for (const f of files) {
      if (/^data.*\.(excel|xlsx|xls)$/i.test(f)) {
        return { filePath: path.join(rootDir, f), fileName: f };
      }
    }
  } catch {}

  return null;
}

/**
 * Parse Excel Buffer or File into standardized participant rows.
 */
export function parseExcelBuffer(buffer: Buffer, fileName = 'data.excel'): ExcelParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error('Excel workbook contains no sheets.');
  }

  // Use the first sheet
  const firstSheet = workbook.Sheets[sheetNames[0]];
  const rawData: RawExcelRow[] = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

  const headers: string[] = [];
  if (rawData.length > 0) {
    Object.keys(rawData[0]).forEach((k) => headers.push(k));
  }

  const normalizedRows: NormalizedParticipantRow[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let studentsCount = 0;
  let facultyCount = 0;
  let guestsCount = 0;

  rawData.forEach((row, idx) => {
    // 1. Extract Serial / Student ID
    const rawSerialVal =
      row.serial ??
      row.Serial ??
      row.SERIAL ??
      row['student id'] ??
      row['Student ID'] ??
      row.student_id ??
      row.Student_ID ??
      row.roll ??
      row.Roll ??
      row.id ??
      row.ID ??
      '';
    const rawSerial = String(rawSerialVal).trim();

    // 2. Extract Name
    const rawNameVal = row.name ?? row.Name ?? row.NAME ?? '';
    const name = String(rawNameVal).trim();

    // 3. Extract Type
    const rawTypeVal = row.type ?? row.Type ?? row.TYPE ?? '';
    let rawTypeStr = String(rawTypeVal).trim().toLowerCase();

    // Normalization mapping for type
    let type: 'student' | 'faculty' | 'guest' = 'student';
    if (rawTypeStr === 'student' || rawTypeStr === 'stu') {
      type = 'student';
    } else if (rawTypeStr === 'faculty' || rawTypeStr === 'teacher' || rawTypeStr === 'fac') {
      type = 'faculty';
    } else if (
      rawTypeStr === 'guest' ||
      rawTypeStr === 'staff' ||
      rawTypeStr === 'visitor' ||
      rawTypeStr === 'alumni'
    ) {
      type = 'guest';
    } else if (rawTypeStr === '') {
      // Default to student if serial looks like a roll number
      type = 'student';
    } else {
      type = 'guest';
    }

    // 4. Extract Designation
    const rawDesigVal = row.designation ?? row.Designation ?? row.DESIGNATION ?? '';
    let designation = String(rawDesigVal).trim();

    // 5. Extract Department
    const rawDeptVal = row.department ?? row.Department ?? row.DEPARTMENT ?? 'CSE';
    const department = String(rawDeptVal).trim() || 'CSE';

    // 6. Validation and rules:
    // "if type is student then has student id otherwise blank"
    let isValid = true;
    let validationError: string | undefined;
    let validationWarning: string | undefined;
    let studentId = '';

    if (!name) {
      isValid = false;
      validationError = 'Missing participant name';
    }

    if (type === 'student') {
      // Must have student ID (from serial or roll)
      studentId = rawSerial;
      if (!studentId) {
        isValid = false;
        validationError = 'Student must have a Student ID in the serial column';
      }
      // Force student designation to 'Student'
      designation = 'Student';
    } else {
      // For faculty and guest: serial / student ID is blank
      studentId = '';
      if (!designation) {
        if (type === 'faculty') {
          designation = 'Faculty Member';
          validationWarning = 'Designation was empty; defaulted to "Faculty Member"';
        } else {
          designation = 'Guest';
          validationWarning = 'Designation was empty; defaulted to "Guest"';
        }
      }
    }

    if (isValid) {
      validCount++;
      if (type === 'student') studentsCount++;
      else if (type === 'faculty') facultyCount++;
      else guestsCount++;
    } else {
      invalidCount++;
    }

    normalizedRows.push({
      rowIndex: idx + 1,
      rawSerial,
      studentId,
      name,
      type,
      designation,
      department,
      isValid,
      validationError,
      validationWarning,
    });
  });

  return {
    fileName,
    fileSize: buffer.length,
    foundInRoot: true,
    totalRows: normalizedRows.length,
    validRows: validCount,
    invalidRows: invalidCount,
    counts: {
      students: studentsCount,
      faculty: facultyCount,
      guests: guestsCount,
    },
    rows: normalizedRows,
    headers,
  };
}

/**
 * Commit normalized rows to the Supabase database.
 * Mode: 'append' (insert or update) | 'replace' (truncate participants first)
 */
export async function commitExcelParticipantsToDb(
  rows: NormalizedParticipantRow[],
  mode: 'append' | 'replace' = 'append'
): Promise<{
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  message: string;
}> {
  const validRows = rows.filter((r) => r.isValid && r.name);
  if (validRows.length === 0) {
    return {
      success: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      message: 'No valid rows to import.',
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    // In-memory fallback
    const result = await supabaseRepository.importParticipants(
      validRows.map((r) => ({
        id: r.studentId || null,
        name: r.name,
        type: r.type,
        designation: r.designation,
      }))
    );
    return {
      success: true,
      inserted: result.inserted,
      updated: 0,
      skipped: 0,
      errors: result.errors,
      message: `Imported ${result.inserted} participants to in-memory store (Supabase not configured).`,
    };
  }

  try {
    // If replace mode, delete all existing participants
    if (mode === 'replace') {
      const { error: delErr } = await client
        .from('cse_fest_2026_participants')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows
      if (delErr) {
        console.warn('[ExcelService] Delete warning during replace:', delErr.message);
      }
    }

    // Format records for cse_fest_2026_participants
    const dbPayload = validRows.map((r) => ({
      external_id: r.studentId || null,
      name: r.name,
      type: r.type,
      designation: r.designation,
      department: r.department || 'CSE',
      eligible: 1,
      updated_at: new Date().toISOString(),
    }));

    // Batch insertion in chunks of 100 to avoid request size limits
    const BATCH_SIZE = 100;
    let insertedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < dbPayload.length; i += BATCH_SIZE) {
      const chunk = dbPayload.slice(i, i + BATCH_SIZE);
      const { error: insertErr } = await client
        .from('cse_fest_2026_participants')
        .insert(chunk);

      if (insertErr) {
        console.error(`[ExcelService] Batch insert error (batch ${i}):`, insertErr.message);
        // Fallback: insert individually to salvage non-conflicting rows
        for (const item of chunk) {
          const { error: singleErr } = await client
            .from('cse_fest_2026_participants')
            .insert(item);
          if (singleErr) {
            errorCount++;
          } else {
            insertedCount++;
          }
        }
      } else {
        insertedCount += chunk.length;
      }
    }

    // Log action to audit log
    await client.from('cse_fest_2026_audit_logs').insert({
      action: 'EXCEL_SEED_IMPORT',
      details: {
        mode,
        total_rows: rows.length,
        valid_rows: validRows.length,
        inserted_count: insertedCount,
        error_count: errorCount,
        timestamp: new Date().toISOString(),
      },
      actor: 'controller',
      ip_address: '127.0.0.1',
    });

    return {
      success: true,
      inserted: insertedCount,
      updated: 0,
      skipped: rows.length - validRows.length,
      errors: errorCount,
      message: `Successfully uploaded ${insertedCount} participants to Supabase (${mode === 'replace' ? 'replaced existing records' : 'appended'}).`,
    };
  } catch (err: any) {
    console.error('[ExcelService] Upload exception:', err);
    return {
      success: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: validRows.length,
      message: `Database upload failed: ${err.message}`,
    };
  }
}

/**
 * Generate a sample data.excel file in the root directory if none exists.
 */
export function ensureSampleExcelFile(): string {
  const rootDir = process.cwd();
  const filePath = path.join(rootDir, 'data.excel');

  if (fs.existsSync(filePath)) {
    return filePath;
  }

  const sampleData = [
    { serial: '2303001', name: 'Tanvir Ahmed', type: 'student', designation: 'Student' },
    { serial: '2303002', name: 'Nusrat Jahan', type: 'student', designation: 'Student' },
    { serial: '2303003', name: 'Arifur Rahman', type: 'student', designation: 'Student' },
    { serial: '2303004', name: 'Farhana Mim', type: 'student', designation: 'Student' },
    { serial: '2303005', name: 'Sabbir Hossain', type: 'student', designation: 'Student' },
    { serial: '2303006', name: 'Jannatul Ferdous', type: 'student', designation: 'Student' },
    { serial: '2303007', name: 'Mahmudul Hasan', type: 'student', designation: 'Student' },
    { serial: '2303008', name: 'Sadia Afrin', type: 'student', designation: 'Student' },
    { serial: '2303009', name: 'Rakibul Islam', type: 'student', designation: 'Student' },
    { serial: '2303010', name: 'Tasnim Sultana', type: 'student', designation: 'Student' },
    { serial: '', name: 'Dr. Md. Zahirul Islam', type: 'faculty', designation: 'Professor & Head' },
    { serial: '', name: 'Dr. Mohammad Nazmul Hassan', type: 'faculty', designation: 'Associate Professor' },
    { serial: '', name: 'Shamima Akter', type: 'faculty', designation: 'Assistant Professor' },
    { serial: '', name: 'Engr. Kazi Moinuddin', type: 'guest', designation: 'Special Guest' },
    { serial: '', name: 'Mahbubur Rahman', type: 'guest', designation: 'Distinguished Guest' },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Participants');

  XLSX.writeFile(wb, filePath, { bookType: 'xlsx' });
  console.log(`[ExcelService] Created sample data.excel in root folder: ${filePath}`);
  return filePath;
}
