// The "What's in this site" page: reads sbom-summary.json from this site and shows it. No tour bundle, no 3D.
(function () {
  var $ = function (id) {
    return document.getElementById(id);
  };
  function text(id, value) {
    $(id).textContent = value;
  }
  function link(id, href, label) {
    var el = $(id);
    el.textContent = '';
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    el.appendChild(a);
  }
  var STATES = {
    ok: 'CRACI recorded this build. The numbers below come from its SBOM (a list of every package, in the CycloneDX format).',
    empty: 'The SBOM for this build is empty: CRACI recorded no packages. The numbers below are not a real count.',
    incomplete: 'The SBOM for this build is incomplete: it lists packages but has no vulnerability data.',
    unavailable: 'There is no SBOM for this build.',
  };
  function show(s) {
    var state = STATES[s.status] || 'The record of this build is in an unknown state.';
    if (s.reason) state += ' Reason: ' + s.reason + '.';
    text('state', state);
    $('state').setAttribute('data-status', s.status || 'unknown');
    if (s.commit) {
      text('commit', s.commit.slice(0, 7));
      $('commit').title = s.commit;
      var full = document.createElement('span');
      full.className = 'full';
      full.textContent = s.commit;
      $('commit').appendChild(document.createElement('br'));
      $('commit').appendChild(full);
    } else text('commit', 'Not recorded');
    if (s.craciJobUrl) link('job', s.craciJobUrl, 'Job ' + s.jobId + ' on CRACI');
    else text('job', 'Not recorded');
    text('components', typeof s.components === 'number' ? String(s.components) : 'No data');
    $('components').setAttribute('data-value', typeof s.components === 'number' ? String(s.components) : '');
    text('fetched', s.fetchedAt ? s.fetchedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : 'Not recorded');
    var cells = document.querySelectorAll('[data-severity]');
    for (var i = 0; i < cells.length; i++) {
      var sev = cells[i].getAttribute('data-severity');
      // Zeros only when the SBOM has vulnerability data; otherwise "No data", never a false zero.
      cells[i].textContent = s.vulnerabilities ? String(s.vulnerabilities[sev] || 0) : 'No data';
    }
    if (!s.vulnerabilities) text('vuln-caption', 'No vulnerability data for this build');
    if (s.sbomFile) link('download', './' + s.sbomFile, 'Download the SBOM (CycloneDX JSON)');
    else text('download', 'No SBOM file in this build.');
  }
  fetch('./sbom-summary.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(show)
    .catch(function () {
      show({ status: 'unavailable', reason: 'this copy of the site has no summary file' });
    });
})();
