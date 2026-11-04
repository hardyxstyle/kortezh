import { createRequire } from 'node:module';
import path from 'node:path';
import { gradeSql, createDb, openDb } from '../content/engine.mjs';
const require = createRequire(import.meta.url);
const root = path.resolve('.');
const initSqlJs = require(path.join(root, 'node_modules/sql.js/dist/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules/sql.js/dist', f) });
const { TASKS, DB_SEEDS } = await import(path.join(root, 'functions/_lib/content.js'));
const snaps = {};
for (const [k, v] of Object.entries(DB_SEEDS)) { const a = createDb(SQL, v.seed); const b = createDb(SQL, v.seed, v.variant); snaps[k] = [a.export(), b.export()]; a.close(); b.close(); }
const T = (id) => TASKS[id];
const nd = (id) => (variant) => openDb(SQL, snaps[TASKS[id].db][variant ? 1 : 0]);
const cases = [
 ['s1-2', 'select номер, име, презиме, фамилия from ученик', false],
 ['s1-2', 'SELECT Номер, Име, Презиме, Фамилия FROM Ученик', true],
 ['s1-2', 'SELECT Номер, Име, Фамилия, Презиме FROM Ученик', false],
 ['s2-5', "SELECT Номер, Име, Презиме, Фамилия FROM Ученик WHERE Номер <= 7 AND Име LIKE 'Б%' OR Име LIKE 'Д%'", true],
 ['s2-5', "SELECT Номер, Име, Презиме, Фамилия FROM Ученик WHERE Номер <= 7 AND (Име LIKE 'Б%' OR Име LIKE 'Д%')", false],
 ['s2-9', "SELECT Име, Фамилия FROM Ученик WHERE Име='Марио' AND ([Дата на раждане] LIKE '2007%' OR Клас='12б')", true],
 ['s3-2', "SELECT Номер, Име, Фамилия FROM Ученик WHERE Клас = '12а' ORDER BY Фамилия", false],
 ['s3-4', "SELECT Име, MIN(Цена) Мин, MAX(Цена) FROM Детайли GROUP BY Име", true],
 ['s4-1', 'SELECT Клас, Номер, Име, Презиме, Фамилия, [Дата на раждане] FROM Ученик WHERE Номер = 7', false],
 ['s4-1', 'SELECT Клас, Номер, Име, Презиме, Фамилия, [Дата на раждане] FROM Ученик WHERE Номер = :номер', true],
 ['s4-5', "SELECT Име, Фамилия, Клас FROM Ученик WHERE Фамилия LIKE :начало || '%'", true],
 ['s5-1', 'CREATE TABLE Клуб (ID int primary key, Име char(30) not null, Ден varchar(10));', true],
 ['s5-1', 'CREATE TABLE Клуб (ID int, Име char(30), Ден text);', false],
 ['s5-2', "INSERT INTO Ученик (Клас, Номер, Име, Презиме, Фамилия, Пол) VALUES ('12а',14,'Красимир','Илиев','Костов','м')", true],
 ['s5-5', "UPDATE Детайли SET Цена = Цена + Цена*0.1 WHERE Име='монитор'", true],
 ['s5-5', "UPDATE Детайли SET Цена = Цена * 1.1", false],
 ['s6-3', 'CREATE TABLE Членство (IDУченик INTEGER, Клуб TEXT NOT NULL, PRIMARY KEY (IDУченик, Клуб), FOREIGN KEY (IDУченик) REFERENCES Ученик(ID));', true],
 ['s7-1', 'SELECT Предмет, Предмети.Клас, [Име на учител], [Фамилия на учител], [e-mail] FROM Предмети JOIN Учител ON Учител.ID = Предмети.[ID Учител]', true],
 ['s7-6', 'SELECT Предмет, Клас, [Фамилия на учител] FROM Предмети JOIN Учител ON Предмети.[ID Учител] = Учител.ID', false],
 ['s8-4', 'SELECT u.Име, u.Фамилия, u.Клас FROM Ученик u LEFT JOIN Оценки o ON o.[ID Ученик]=u.ID WHERE o.ID IS NULL', true],
 ['s8-8', 'DELETE FROM Успех WHERE Average < 4.82', false],
 ['s9-4', 'SELECT DISTINCT u.Име, u.Фамилия, u.Клас FROM Ученик u JOIN Оценки o ON o.[ID Ученик]=u.ID WHERE o.Оценка=6', true],
 ['s9-4', 'SELECT u.Име, u.Фамилия, u.Клас FROM Ученик u JOIN Оценки o ON o.[ID Ученик]=u.ID WHERE o.Оценка=6', false],
 ['s1-1', 'DROP TABLE Ученик; SELECT 1', false],
 ['s1-1', "SELECT * FROM Ученик; SELECT * FROM Учител", false],
 ['s7-16', 'SELECT Филм.Заглавие, COUNT(*) FROM Филм LEFT JOIN Прожекция ON Прожекция.[ID Филм] = Филм.ID GROUP BY Филм.ID', false],
 ['s7-16', 'SELECT f.Заглавие, (SELECT COUNT(*) FROM Прожекция p WHERE p.[ID Филм] = f.ID) FROM Филм f', true],
 ['s8-19', 'SELECT Име, Фамилия FROM Режисьор WHERE ID IN (SELECT [ID Режисьор] FROM Филм) AND ID NOT IN (SELECT [ID Режисьор] FROM Филм WHERE Рейтинг < 7)', false],
 ['s8-14', 'SELECT f.Заглавие FROM Филм f LEFT JOIN Прожекция p ON p.[ID Филм]=f.ID WHERE p.ID IS NULL', true],
 ['s2-20', 'SELECT Заглавие, Минути, Минути / 60 FROM Филм', false],
 ['s9-9', "SELECT Заглавие, Рейтинг FROM Филм WHERE Рейтинг IS NOT NULL ORDER BY Рейтинг DESC LIMIT 5", true],
 ['k-b6', "UPDATE Билет SET Цена = 5 WHERE [ID Прожекция] = 24 AND Вид = 'ученически'", true],
];
let bad=0;
for (const [id, sql, want] of cases) {
  const t0=performance.now(); const r = gradeSql(T(id), sql, nd(id)); const ms=(performance.now()-t0).toFixed(1);
  const ok = r.ok === want; if(!ok) bad++;
  console.log(ok?'OK ':'XX ', id, ms+'ms', r.ok, r.message.slice(0,110));
}
console.log('fails', bad);
