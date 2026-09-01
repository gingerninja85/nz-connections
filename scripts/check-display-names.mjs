import { humanDisplayName } from '../src/lib/displayName.ts';

const cases = [
  ['766-24-234-GS - Cycle Skills Training', 'Cycle Skills Training'],
  ['746-23-272-TTG - Innovative Streets Programme - Regional Safety Improvements 2023', 'Innovative Streets Programme - Regional Safety Improvements 2023'],
  ['746-23-616-PS Transport Engineering Professional Services (TEPS) Supplier Panel', 'Transport Engineering Professional Services (TEPS) Supplier Panel'],
  ['TTEPS_746-22-228-TTG_School Speed Management_Tranche 2B', 'School Speed Management Tranche 2B'],
  ['Asset Database Support & Improvement Project (ADS&IP) - Supplier Panel', 'Asset Database Support & Improvement Project (ADS&IP) - Supplier Panel'],
  ['Cycle Skills Training Programme', 'Cycle Skills Training Programme'],
  ['2023 Regional Road Safety Improvements', '2023 Regional Road Safety Improvements']
];

let failed = 0;
for (const [source, expected] of cases) {
  const actual = humanDisplayName(source);
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${source}\n      → ${actual}`);
  if (!ok) { console.log(`      expected: ${expected}`); failed++; }
}
if (failed) process.exitCode = 1;
