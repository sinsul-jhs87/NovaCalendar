(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const T = new Date();
  const day = (n) => { const d = new Date(T); d.setDate(d.getDate() + n); return key(d); };
  const C = { blue: '#5b9dff', red: '#ff6b7a', green: '#3ec99a', amber: '#f2a93b', purple: '#a98bff', teal: '#34c5d8', pink: '#f272b0', gray: '#8b94a8' };
  const base = { allDay: false, startTime: null, endTime: null, memo: '', reminders: [], calendarId: 'local', remoteId: null, updatedAt: 1, deleted: false, readOnly: false, dirty: false };
  let n = 0;
  const e = (title, a, b, color, time, end, extra = {}) => ({
    ...base, id: 'p' + ++n, title, startDate: day(a), endDate: day(b ?? a), color: C[color],
    allDay: !time, startTime: time || null, endTime: end || null, ...extra,
  });
  const list = [
    e('개천절 휴무', -26, -26, 'red'),
    e('분기 계획 회의', -22, -22, 'blue', '10:00', '11:30'),
    e('한글날', -19, -19, 'red'),
    e('제주 출장', -17, -15, 'pink'),
    e('치과 검진', -13, -13, 'amber', '16:00', '17:00'),
    e('디자인 리뷰', -9, -9, 'blue', '10:00', '11:00'),
    e('스프린트 회고', -9, -9, 'green', '15:00', '16:00'),
    e('제품 발표', -7, -7, 'purple'),
    e('부모님 생신', -5, -5, 'pink'),
    e('요가 수업', -3, -3, 'teal', '19:30', '20:30'),
    e('프로젝트 마감', 0, 0, 'red'),
    e('아침 운동', 0, 0, 'green', '07:00', '08:00', { reminders: [10] }),
    e('점심 약속', 0, 0, 'teal', '12:00', '13:00'),
    e('주간 팀 회의', 0, 0, 'blue', '14:00', '15:00', { memo: '안건: 10월 마감 점검, 다음 분기 일정 공유', reminders: [10, 60] }),
    e('치과 상담', 0, 0, 'amber', '16:30', '17:00'),
    e('독서 모임', 0, 0, 'purple', '21:00', '22:00'),
    e('팀 워크숍', 1, 2, 'purple'),
    e('월말 정산', 3, 3, 'red'),
  ];
  window.__mock.events.splice(0, window.__mock.events.length, ...list);
})();
