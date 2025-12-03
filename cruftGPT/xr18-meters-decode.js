// xr18-meters-decode.js
// Decode one XR18 meters/1 blob you captured via tcpdump

const hex = `
2800 0000 3ca4 76a2 959c 15a0 ffb5 ea9c
d19c d5aa dfa4 60a2 be99 249d 879c 8aa7
379c cd9b ada6 80a7 21fe 21fe 0080 0080
0080 0080 0080 0080 0080 0080 0080 0080
0080 0080 0080 0080 0080 0080 0080 0080
0080 0080
`.trim();

const clean = hex.replace(/\s+/g, '');
const buf = Buffer.from(clean, 'hex');

console.log('blob length bytes =', buf.length);

const labels = [
  'hdr0',
  'hdr1',
  'ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06',
  'ch07', 'ch08', 'ch09', 'ch10', 'ch11', 'ch12',
  'ch13', 'ch14', 'ch15', 'ch16', 'ch17', 'ch18',
  'mainL', 'mainR'
];

const count = buf.length / 2;
for (let i = 0; i < count; i++) {
  const v = buf.readUInt16BE(i * 2);
  const label = labels[i] || `extra${i - labels.length}`;
  console.log(
    i.toString().padStart(2, '0'),
    label.padEnd(6),
    '0x' + v.toString(16).padStart(4, '0'),
    v
  );
}
