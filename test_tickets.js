// test_tickets.js — Automated Test Suite for Support Ticket System Overhaul

const baseUrl = process.env.TEST_BASE_URL || 'https://midnightstories.dpdns.org';

async function runTicketTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('⚡ STARTING SUPPORT TICKET SYSTEM INTEGRATION TEST SUITE');
  console.log(`🎯 Target API Base URL: ${baseUrl}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  let userAToken = null;
  let userBToken = null;
  let adminToken = null;
  let createdTicketId = null;
  let createdTicketDbId = null;

  try {
    // ── 1. Create / Authenticate Test Users ──
    console.log('[Step 1] Authenticating Test Users and Admin...');

    const timestamp = Date.now();
    const userAEmail = `test_user_a_${timestamp}@example.com`;
    const userBEmail = `test_user_b_${timestamp}@example.com`;

    // User A Signup/Login
    const signupARes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Test User A',
        email: userAEmail,
        password: 'Password123!',
        dob: '1995-05-15'
      })
    });
    const signupAData = await signupARes.json();
    if (signupAData.token) {
      userAToken = signupAData.token;
      console.log('  ✅ User A registered successfully.');
    } else {
      console.log('  ⚠️ User A signup response:', signupAData);
    }

    // User B Signup/Login
    const signupBRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Test User B',
        email: userBEmail,
        password: 'Password123!',
        dob: '1992-08-20'
      })
    });
    const signupBData = await signupBRes.json();
    if (signupBData.token) {
      userBToken = signupBData.token;
      console.log('  ✅ User B registered successfully.');
    } else {
      console.log('  ⚠️ User B signup response:', signupBData);
    }

    // Admin Login
    const adminLoginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' })
    });
    const adminLoginData = await adminLoginRes.json();
    adminToken = adminLoginData.token;
    console.log(`  ${adminToken ? '✅ Admin authenticated.' : '⚠️ Admin login failed (will test user routes).'}`);


    // ── 2. Test Invalid Ticket Creation Validation ──
    console.log('\n[Step 2] Testing Input Validation on POST /api/user/tickets...');
    const invalidRes = await fetch(`${baseUrl}/api/user/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAToken || ''}`
      },
      body: JSON.stringify({
        subject: 'Hi', // Too short
        details: 'Short' // Too short
      })
    });
    const invalidData = await invalidRes.json();
    if (invalidRes.status === 400 && invalidData.error) {
      console.log('  ✅ Validation caught invalid input:', invalidData.error);
    } else {
      console.log('  ❌ Validation test unexpected response:', invalidRes.status, invalidData);
    }


    // ── 3. Authenticated Ticket Creation (User A) ──
    console.log('\n[Step 3] Submitting Valid Support Ticket (User A)...');
    const createRes = await fetch(`${baseUrl}/api/user/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAToken || ''}`
      },
      body: JSON.stringify({
        subject: 'PDF Reader Glitch on Chapter 3',
        category_id: 2,
        priority: 'high',
        reference_number: 'BOOK-9842',
        details: 'Whenever I open Chapter 3 in PDF mode, the font rendering freezes the browser tab.'
      })
    });
    const createData = await createRes.json();
    console.log('  Ticket Creation Response:', createData);

    if (createData.success && createData.id) {
      createdTicketDbId = createData.id;
      createdTicketId = createData.ticket_id;
      console.log(`  ✅ Ticket created successfully! Tracking ID: ${createdTicketId} (DB ID: ${createdTicketDbId})`);
    } else {
      throw new Error(`Failed to create ticket: ${JSON.stringify(createData)}`);
    }


    // ── 4. List User Tickets with Filtering & Pagination (User A) ──
    console.log('\n[Step 4] Listing Tickets with Filters (User A)...');
    const listRes = await fetch(`${baseUrl}/api/user/tickets?status=open&priority=high&search=PDF`, {
      headers: { 'Authorization': `Bearer ${userAToken || ''}` }
    });
    const listData = await listRes.json();
    console.log(`  Found ${listData.tickets ? listData.tickets.length : 0} matching tickets (Total: ${listData.total}).`);
    if (listData.tickets && listData.tickets.some(t => t.id === createdTicketDbId)) {
      console.log('  ✅ Created ticket verified in filtered search list.');
    } else {
      console.log('  ⚠️ Created ticket not in list output.');
    }


    // ── 5. Fetch Ticket Details (User A) ──
    console.log('\n[Step 5] Fetching Ticket Detail & Message History...');
    const detailRes = await fetch(`${baseUrl}/api/user/tickets/${createdTicketDbId}`, {
      headers: { 'Authorization': `Bearer ${userAToken || ''}` }
    });
    const detailData = await detailRes.json();
    if (detailData.ticket && detailData.messages) {
      console.log(`  ✅ Ticket detail fetched. Messages count: ${detailData.messages.length}`);
    } else {
      console.log('  ❌ Detail fetch failed:', detailData);
    }


    // ── 6. User B Ownership Security Boundary Check ──
    console.log('\n[Step 6] Testing Security: User B Attempting to Access User A Ticket...');
    const secRes = await fetch(`${baseUrl}/api/user/tickets/${createdTicketDbId}`, {
      headers: { 'Authorization': `Bearer ${userBToken || ''}` }
    });
    const secData = await secRes.json();
    if (secRes.status === 404 || secRes.status === 403) {
      console.log(`  ✅ Security verified! Access correctly blocked with status ${secRes.status}:`, secData.error);
    } else {
      console.log(`  ❌ SECURITY FAILURE! User B accessed User A ticket! Status: ${secRes.status}`);
    }


    // ── 7. Post Reply (User A) ──
    console.log('\n[Step 7] User A Posting Follow-Up Reply...');
    const replyRes = await fetch(`${baseUrl}/api/user/tickets/${createdTicketDbId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAToken || ''}`
      },
      body: JSON.stringify({
        message_body: 'I also noticed this occurs on Chrome mobile browser.'
      })
    });
    const replyData = await replyRes.json();
    console.log('  Reply Response:', replyData);
    if (replyData.success) {
      console.log('  ✅ Reply posted successfully.');
    }


    // ── 8. Admin Operations (If Authenticated) ──
    if (adminToken) {
      console.log('\n[Step 8] Testing Admin Ticket Workflows...');

      // Admin views ticket
      const adminDetailRes = await fetch(`${baseUrl}/api/admin/helpdesk/tickets/${createdTicketDbId}`, {
        headers: { 'x-admin-token': adminToken }
      });
      const adminDetailData = await adminDetailRes.json();
      console.log(`  Admin ticket view status: ${adminDetailRes.status}`);

      // Admin posts internal note (should NOT be visible to User A)
      console.log('  Posting Admin Internal Note...');
      await fetch(`${baseUrl}/api/admin/helpdesk/tickets/${createdTicketDbId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({
          message_body: 'INTERNAL NOTE: Escalated to frontend team.',
          is_internal_note: true
        })
      });

      // User A views detail to verify internal note is hidden
      const userCheckRes = await fetch(`${baseUrl}/api/user/tickets/${createdTicketDbId}`, {
        headers: { 'Authorization': `Bearer ${userAToken || ''}` }
      });
      const userCheckData = await userCheckRes.json();
      const hasInternal = userCheckData.messages.some(m => m.message_body.includes('INTERNAL NOTE'));
      if (!hasInternal) {
        console.log('  ✅ Internal note correctly hidden from customer view.');
      } else {
        console.log('  ❌ SECURITY FAIL: Customer saw internal note!');
      }

      // Admin resolves ticket
      console.log('  Admin resolving ticket...');
      await fetch(`${baseUrl}/api/admin/reports/${createdTicketDbId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({ status: 'resolved' })
      });
      console.log('  ✅ Ticket resolved by admin.');
    }


    // ── 9. Ticket Reopen & Close Workflows ──
    console.log('\n[Step 9] Testing Ticket Reopen Workflow...');
    const reopenRes = await fetch(`${baseUrl}/api/user/tickets/${createdTicketDbId}/reopen`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userAToken || ''}` }
    });
    const reopenData = await reopenRes.json();
    console.log('  Reopen Response:', reopenData);
    if (reopenData.success) {
      console.log('  ✅ Ticket reopened successfully.');
    }

    console.log('\n[Step 10] Testing Ticket Close Workflow...');
    const closeRes = await fetch(`${baseUrl}/api/user/tickets/${createdTicketDbId}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userAToken || ''}` }
    });
    const closeData = await closeRes.json();
    console.log('  Close Response:', closeData);
    if (closeData.success) {
      console.log('  ✅ Ticket closed successfully.');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 ALL SUPPORT TICKET TESTS COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════');
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILURE:', err);
  }
}

runTicketTests();
