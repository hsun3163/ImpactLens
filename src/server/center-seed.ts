/** Fixed fictional collection, explicitly created by an authenticated administrator.
 * Provenance remains durable and separate from raw SMS receipts and real outcomes.
 */
export const CENTER_COLLECTION_SOURCE = 'generated-center-collection-v1';
export const CENTER_COLLECTION_BATCH_ID = '7ca10000-0000-4000-8000-000000000001';
const id = (kind: number, index: number) => `7ca1${kind.toString().padStart(4, '0')}-0000-4000-8000-${index.toString().padStart(12, '0')}`;
const centerNames = ['Alder Grove Center', 'Cedar Ridge Center', 'Willow Harbor Center', 'Juniper Valley Center'];
const programNames = ['Pathways & Purpose', 'Creative Expression', 'Skills for Tomorrow'];
const dates = ['2026-09-14','2026-09-21','2026-09-28','2026-10-05','2026-10-12','2026-10-19'];
export const CENTER_COLLECTION = centerNames.map((name, ci) => ({
  id: id(1,ci+1), name, slug: `collection-${['alder-grove','cedar-ridge','willow-harbor','juniper-valley'][ci]}`,
  programs: programNames.map((programName, pi) => {
    const index = ci*3+pi+1;
    const attendees = [12+ci*3+pi,14+ci*3+pi,13+ci*3+pi,16+ci*3+pi,17+ci*3+pi,18+ci*3+pi];
    const sessionMinutes = [90,120,150][pi];
    return { id:id(2,index), courseId:id(3,index), name:programName, facility:`${name} · Learning Studio ${pi+1}`, yard:null,
      startDate:dates[0], endDate:dates.at(-1)!, status:'completed' as const,
      participants:Math.max(...attendees), completers:Math.max(...attendees)-2,
      courseHoursPerParticipant:sessionMinutes*dates.length/60,
      sessions:dates.map((date,si)=>({ id:id(4,(index-1)*6+si+1), receivedAt:`${date}T${(14+pi).toString().padStart(2,'0')}:00:00.000Z`, attendees:attendees[si], sessionMinutes })) };
  }),
}));
export const CENTER_COLLECTION_MANIFEST = {
  source:CENTER_COLLECTION_SOURCE, fictional:true, centers:CENTER_COLLECTION.length,
  programs:CENTER_COLLECTION.flatMap(c=>c.programs).length,
  courses:CENTER_COLLECTION.flatMap(c=>c.programs).length,
  sessions:CENTER_COLLECTION.flatMap(c=>c.programs.flatMap(p=>p.sessions)).length,
  organizationIds:CENTER_COLLECTION.map(c=>c.id),
};

export async function seedCenterCollection(db:D1Database,userId:string) {
  if (!userId || !userId.trim()) throw new Error('An authenticated administrator is required.');
  const existing = await db.prepare('SELECT id FROM center_seed_batches WHERE id=?').bind(CENTER_COLLECTION_BATCH_ID).first();
  if(existing) return {...CENTER_COLLECTION_MANIFEST,alreadyPresent:true};
  const now=new Date().toISOString();
  const statements:D1PreparedStatement[]=[db.prepare('INSERT OR IGNORE INTO center_seed_batches(id,source,created_by,created_at,manifest_json) VALUES(?,?,?,?,?)')
    .bind(CENTER_COLLECTION_BATCH_ID,CENTER_COLLECTION_SOURCE,userId,now,JSON.stringify(CENTER_COLLECTION_MANIFEST))];
  for(const center of CENTER_COLLECTION) {
    statements.push(db.prepare('INSERT OR IGNORE INTO sms_organizations(id,name,slug,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind(center.id,center.name,center.slug,now,now));
    for(const program of center.programs) {
      statements.push(db.prepare('INSERT OR IGNORE INTO sms_programs(id,organization_id,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind(program.id,center.id,program.name,now,now));
      statements.push(db.prepare('INSERT OR IGNORE INTO course_summaries(id,revision,organization_id,program_id,facility,yard,status,start_date,end_date,course_hours_per_participant,participants,completers,notes,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(program.courseId,center.id,program.id,program.facility,program.yard,program.status,program.startDate,program.endDate,program.courseHoursPerParticipant,program.participants,program.completers,null,now,now));
      const snapshot=JSON.stringify({id:program.courseId,organizationId:center.id,programId:program.id,organizationName:center.name,programName:program.name,facility:program.facility,yard:program.yard,startDate:program.startDate,endDate:program.endDate});
      // Six rows / 66 bindings per statement: keep the atomic batch at 41 statements
      // and every statement below D1's 100-bound-parameter limit.
      const rows = program.sessions.map(session => [session.id,CENTER_COLLECTION_BATCH_ID,CENTER_COLLECTION_SOURCE,center.id,program.id,program.courseId,session.attendees,session.sessionMinutes,session.receivedAt,session.receivedAt,snapshot]);
      statements.push(db.prepare(`INSERT OR IGNORE INTO generated_activity(id,seed_batch_id,source,organization_id,program_id,course_id,attendees,session_minutes,received_at,processed_at,course_snapshot_json) VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',')}`)
        .bind(...rows.flat()));
    }
  }
  // D1 batch is atomic: no partial collection or partial audit marker survives failure.
  const results=await db.batch(statements);
  return {...CENTER_COLLECTION_MANIFEST,alreadyPresent:results[0]?.meta?.changes===0};
}
