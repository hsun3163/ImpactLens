/** Owner-requested fictional attendance points; never SMS receipts or verified outcomes. */
export const DEFY_ACTIVITY_SOURCE = 'generated-defy-course-activity-v1';
export const DEFY_ACTIVITY_BATCH_ID = '7da10000-0000-4000-8000-000000000001';
export const DEFY_ORGANIZATION_ID = '9ac84c26-2dcb-4357-9bff-0efe2ce0e000';
export const DEFY_PROGRAM_ID = 'f25562f7-a9bc-4db6-a36d-ce715df5780d';
const dates = ['2026-09-15','2026-09-22','2026-09-29','2026-10-06','2026-10-13','2026-10-20'];
export const DEFY_ACTIVITY_COURSES = [
  {id:'1660ac7b-a4f4-4e2e-974b-d31db061de71',facility:'California State Prison, Los Angeles County',attendees:[14,16,15,18,19,20]},
  {id:'5036e3f7-789d-4176-ab16-cec9601ef6df',facility:'California State Prison, Centinela (CEN)',attendees:[12,14,13,16,17,18]},
] as const;
export const DEFY_ACTIVITY_MANIFEST = {source:DEFY_ACTIVITY_SOURCE,fictional:true,organizationId:DEFY_ORGANIZATION_ID,programId:DEFY_PROGRAM_ID,
  courseIds:DEFY_ACTIVITY_COURSES.map(c=>c.id),courses:2,sessions:12,sessionHours:24,participantHours:384};
const courseSelect=`SELECT c.*,o.name organization_name,p.name program_name FROM course_summaries c
  JOIN sms_organizations o ON o.id=c.organization_id JOIN sms_programs p ON p.id=c.program_id AND p.organization_id=c.organization_id
  WHERE c.id=? AND c.organization_id=? AND c.program_id=?`;

export async function seedDefyActivity(db:D1Database,userId:string) {
  if(!userId.trim())throw new Error('An authenticated administrator is required.');
  const courses:Record<string,unknown>[]=[];
  for(const target of DEFY_ACTIVITY_COURSES){
    const course=await db.prepare(courseSelect).bind(target.id,DEFY_ORGANIZATION_ID,DEFY_PROGRAM_ID).first<Record<string,unknown>>();
    if(!course || course.facility!==target.facility)throw new Error('The requested Defy course scope changed; no activity was added.');
    courses.push(course);
  }
  if(await db.prepare('SELECT id FROM center_seed_batches WHERE id=?').bind(DEFY_ACTIVITY_BATCH_ID).first())return {...DEFY_ACTIVITY_MANIFEST,alreadyPresent:true};
  const now=new Date().toISOString();
  // Revalidate both exact course scopes inside the transaction. NOT NULL rejects a
  // changed scope atomically, before any points can be committed.
  const statements:D1PreparedStatement[]=[db.prepare(`INSERT INTO center_seed_batches(id,source,created_by,created_at,manifest_json)
    VALUES(?,?,?,?,CASE WHEN (SELECT COUNT(*) FROM course_summaries c JOIN sms_programs p ON p.id=c.program_id AND p.organization_id=c.organization_id
      WHERE c.organization_id=? AND c.program_id=? AND ((c.id=? AND c.facility=?) OR (c.id=? AND c.facility=?)))=2 THEN ? ELSE NULL END) ON CONFLICT(id) DO NOTHING`)
    .bind(DEFY_ACTIVITY_BATCH_ID,DEFY_ACTIVITY_SOURCE,userId,now,DEFY_ORGANIZATION_ID,DEFY_PROGRAM_ID,
      DEFY_ACTIVITY_COURSES[0].id,DEFY_ACTIVITY_COURSES[0].facility,DEFY_ACTIVITY_COURSES[1].id,DEFY_ACTIVITY_COURSES[1].facility,JSON.stringify(DEFY_ACTIVITY_MANIFEST))];
  for(let ci=0;ci<courses.length;ci++){
    const course=courses[ci];const target=DEFY_ACTIVITY_COURSES[ci];
    const snapshot=JSON.stringify({id:target.id,organizationId:DEFY_ORGANIZATION_ID,programId:DEFY_PROGRAM_ID,
      organizationName:course.organization_name,programName:course.program_name,facility:course.facility,yard:course.yard,
      startDate:course.start_date,endDate:course.end_date});
    const rows=target.attendees.map((attendees,si)=>{
      const at=`${dates[si]}T${14+ci}:00:00.000Z`;
      return [`7da10001-0000-4000-8000-${(ci*6+si+1).toString().padStart(12,'0')}`,DEFY_ACTIVITY_BATCH_ID,DEFY_ACTIVITY_SOURCE,DEFY_ORGANIZATION_ID,DEFY_PROGRAM_ID,target.id,attendees,120,at,at,snapshot];
    });
    // Three statements total, at most 66 bindings per statement.
    statements.push(db.prepare(`INSERT OR IGNORE INTO generated_activity(id,seed_batch_id,source,organization_id,program_id,course_id,attendees,session_minutes,received_at,processed_at,course_snapshot_json) VALUES ${rows.map(()=>'(?,?,?,?,?,?,?,?,?,?,?)').join(',')}`).bind(...rows.flat()));
  }
  const results=await db.batch(statements);
  return {...DEFY_ACTIVITY_MANIFEST,alreadyPresent:results[0]?.meta?.changes===0};
}
