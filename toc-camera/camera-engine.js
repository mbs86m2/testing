grid.innerHTML = photos.map(p => {
    const ts = getPhotoTimeMs(p);
    const isWithin = isTimeWithinActiveHours(ts);
    const elapsed = now - ts;
    const remainingMs = Math.max(0, (3 * 60 * 1000) - elapsed);
    const remainingSecs = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(remainingSecs / 60);
    const secs = remainingSecs % 60;
    const timerStr = `${mins}:${String(secs).padStart(2, '0')}`;

    const delBadge = !isWithin
      ? (remainingSecs > 0
          ? `<div data-timestamp="${ts}" class="auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-rose-600/90 rounded text-[8px] font-mono font-bold text-white flex items-center gap-0.5">⏱ ${timerStr}</div>`
          : `<div data-timestamp="${ts}" class="auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-rose-600/90 rounded text-[8px] font-mono font-bold text-white uppercase">DEL...</div>`)
      : `<div data-timestamp="${ts}" class="auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-emerald-600/90 rounded text-[8px] font-mono font-bold text-white uppercase">PROTECTED</div>`;

    const plateBadge = (p.plateNumber && p.plateNumber !== "NO PLATE")
      ? `<div class="absolute bottom-1 left-1 px-1.5 py-0.5 bg-sky-950/90 border border-sky-400/50 rounded text-[8px] font-mono font-extrabold text-sky-200">🚘 ${p.plateNumber}</div>`
      : '';

    return `
      <div onclick="openLightbox('${p.id}')" class="relative aspect-square bg-[#161e2e] rounded-xl overflow-hidden border border-white/10 cursor-pointer shadow-sm">
        <img src="${p.dataUrl}" class="w-full h-full object-cover">
        <div class="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-bold ${p.isSynced ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-slate-950'}">
          ${p.isSynced ? '✓ Synced' : '☁ Queue'}
        </div>
        ${plateBadge}
        ${delBadge}
      </div>
    `;
  }).join('');