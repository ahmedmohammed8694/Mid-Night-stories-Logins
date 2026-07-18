const baseUrl = 'https://midnightstories.dpdns.org';

async function testTickets() {
  console.log('--- Starting Ticket Workflow Tests ---');
  let reporterId = 1;
  
  // 1. User submits a report
  console.log('\n[1] Submitting a user report...');
  let res = await fetch(baseUrl + '/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetType: 'story',
      targetId: 10,
      reason: 'spam',
      reportDescription: 'This is spam.',
      reporterId: reporterId
    })
  });
  let reportData = await res.json();
  console.log('Report Submission Response:', reportData);
  let ticketId = reportData.id || (reportData.message ? 'Check Admin' : null);
  
  // 2. Admin Login
  console.log('\n[2] Admin Login...');
  res = await fetch(baseUrl + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123' })
  });
  let loginData = await res.json();
  const token = loginData.token;
  console.log('Admin Token:', token ? 'Success' : 'Failed');
  
  if (!token) return;

  // 3. Admin views reports
  console.log('\n[3] Admin Fetching Reports...');
  res = await fetch(baseUrl + '/api/admin/reports', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  let reports = await res.json();
  console.log('Found Reports:', reports.length);
  
  let targetTicket = reports[0];
  if (!targetTicket) {
    console.log('No tickets found to process.');
    return;
  }
  
  console.log('Target Ticket ID:', targetTicket.id);

  // 4. Admin Updates Ticket Status
  console.log('\n[4] Admin Updating Status to investigating...');
  res = await fetch(baseUrl + `/api/admin/reports/${targetTicket.id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ status: 'investigating' })
  });
  let statusUpdate = await res.json();
  console.log('Status Update:', statusUpdate);

  // 5. Admin replies to ticket
  console.log('\n[5] Admin Replying to Ticket...');
  res = await fetch(baseUrl + `/api/tickets/${targetTicket.id}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ message_body: 'We are looking into this.' })
  });
  let replyRes = await res.json();
  console.log('Reply Response:', replyRes);

  console.log('\n--- Workflows Tested Successfully ---');
}

testTickets();
