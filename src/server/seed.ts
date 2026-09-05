import fs from 'fs';
import path from 'path';

const firstNames = [
  "Md. Arif", "Shahriar", "Tanvir", "Sabbir", "Naimur", "Zubair", "Mahfuzur", "Rakibul",
  "Sadia", "Fatima", "Nusrat", "Sumaiya", "Farhana", "Ayesha", "Tasnim", "Israt",
  "Mohammad", "Kazi", "Nahid", "Faisal", "Mehedi", "Tanzim", "Rashedul", "Ahsan",
  "Rumana", "Shirin", "Jannatul", "Afroza", "Rabeya", "Salma", "Sharmin", "Sabrina"
];

const lastNames = [
  "Rahman", "Islam", "Hasan", "Ahmed", "Haque", "Hossain", "Alam", "Karim",
  "Akter", "Khatun", "Begum", "Siddiqua", "Sultana", "Parvin", "Nasrin", "Mahmud",
  "Shanto", "Miraz", "Sakib", "Ritu", "Mim", "Ema", "Habib", "Aziz"
];

const students: { id: string; name: string }[] = [];
let studentCount = 1;

// Batch 23 (First Year)
for (let i = 1; i <= 60; i++) {
  const fName = firstNames[(i * 3) % firstNames.length];
  const lName = lastNames[(i * 5) % lastNames.length];
  const idStr = `2303${String(i).padStart(3, '0')}`;
  students.push({ id: idStr, name: `${fName} ${lName}` });
}

// Batch 22 (Second Year)
for (let i = 1; i <= 50; i++) {
  const fName = firstNames[(i * 7) % firstNames.length];
  const lName = lastNames[(i * 2) % lastNames.length];
  const idStr = `2203${String(i).padStart(3, '0')}`;
  students.push({ id: idStr, name: `${fName} ${lName}` });
}

// Batch 21 (Third Year)
for (let i = 1; i <= 45; i++) {
  const fName = firstNames[(i * 4) % firstNames.length];
  const lName = lastNames[(i * 9) % lastNames.length];
  const idStr = `2103${String(i).padStart(3, '0')}`;
  students.push({ id: idStr, name: `${fName} ${lName}` });
}

// Batch 20 (Fourth Year)
for (let i = 1; i <= 40; i++) {
  const fName = firstNames[(i * 11) % firstNames.length];
  const lName = lastNames[(i * 6) % lastNames.length];
  const idStr = `2003${String(i).padStart(3, '0')}`;
  students.push({ id: idStr, name: `${fName} ${lName}` });
}

const faculties = [
  { name: "Prof. Dr. Md. Fazlul Hasan", designation: "Professor & Head" },
  { name: "Prof. Dr. Mohammad Shamsul Arefin", designation: "Professor" },
  { name: "Dr. Md. Rafiqul Islam", designation: "Associate Professor" },
  { name: "Dr. Mohammad Shoyaib", designation: "Associate Professor" },
  { name: "Engr. Tanvir Ahmed", designation: "Assistant Professor" },
  { name: "Engr. Sabrina Sharmin", designation: "Assistant Professor" },
  { name: "Engr. Mahmudul Hasan", designation: "Assistant Professor" },
  { name: "Engr. Farhana Sarker", designation: "Lecturer" },
  { name: "Engr. Kamrul Islam", designation: "Lecturer" },
  { name: "Engr. Shamima Nasrin", designation: "Lecturer" },
  { name: "Engr. Al-Amin Hossain", designation: "Lecturer" },
  { name: "Engr. Tania Sultana", designation: "Lecturer" }
];

const staffs = [
  { name: "Md. Karim Ullah", designation: "Senior Office Assistant" },
  { name: "Abul Kalam Azad", designation: "Lab Technician (Hardware)" },
  { name: "Md. Shah Alam", designation: "Hardware Specialist" },
  { name: "Nazma Begum", designation: "Administrative Officer" },
  { name: "Md. Harun-ur-Rashid", designation: "Store Keeper" },
  { name: "Md. Nurul Islam", designation: "Network Operator" },
  { name: "Md. Mizanur Rahman", designation: "Lab Assistant (Software)" },
  { name: "Rina Akter", designation: "Senior Clerk" }
];

const participants = [
  ...students.map(s => ({
    type: "student",
    id: s.id,
    name: s.name,
    designation: null,
    eligible: 1
  })),
  ...faculties.map(f => ({
    type: "faculty",
    id: null,
    name: f.name,
    designation: f.designation,
    eligible: 1
  })),
  ...staffs.map(st => ({
    type: "staff",
    id: null,
    name: st.name,
    designation: st.designation,
    eligible: 1
  }))
];

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

fs.writeFileSync(path.join(dataDir, 'participants.json'), JSON.stringify(participants, null, 2));

const initialResult = {
  event: "DUET CSE Fest 2026",
  total_winners: 10,
  results: [],
  ignored: []
};
fs.writeFileSync(path.join(dataDir, 'result.json'), JSON.stringify(initialResult, null, 2));

const initialSession = {
  event: "DUET CSE Fest 2026",
  status: "READY",
  total_winners: 10,
  completed_winners: 0,
  next_serial: 1,
  current_candidate: null,
  last_action: "SYSTEM_INITIALIZED",
  updated_at: new Date().toISOString()
};
fs.writeFileSync(path.join(dataDir, 'session.json'), JSON.stringify(initialSession, null, 2));

const initialAudit = [
  {
    action: "SYSTEM_INITIALIZED",
    timestamp: new Date().toISOString(),
    details: { total_participants: participants.length, total_winners: 10 }
  }
];
fs.writeFileSync(path.join(dataDir, 'audit.json'), JSON.stringify(initialAudit, null, 2));

console.log(`Successfully generated data files with ${participants.length} participants.`);
