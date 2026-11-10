import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import type { Habitacion, ReservaHotel } from '../../utils/types';

const DAY_WIDTH = 88;
export const calendarDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days*86400000).toISOString().slice(0,10);
const distance = (a: string, b: string) => Math.round((Date.parse(a)-Date.parse(b))/86400000);
const colors = { confirmada:'bg-blue-600', checkin:'bg-emerald-700', checkout:'bg-slate-500', cancelada:'bg-red-600' };
type Move = { reservation: ReservaHotel; roomId: string; checkIn: string };
type Drag = Move & { x: number; scroll: number; valid: boolean; keyboard: boolean };

export function ReservationCalendar({ rooms, reservations, days, canMove, onSelect, onMove }: {
  rooms: Habitacion[]; reservations: ReservaHotel[]; days: Date[]; canMove: boolean;
  onSelect: (reservation: ReservaHotel) => void; onMove: (move: Move) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointer = useRef<{x:number;y:number} | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const first = calendarDate(days[0]);
  const publish = (value: Drag | null) => { dragRef.current=value; setDrag(value); };
  const hit = () => {
    const current=dragRef.current, point=pointer.current, scroller=scroll.current;
    if (!current || current.keyboard || !point || !scroller) return;
    const bounds=scroller.getBoundingClientRect();
    const row=Array.from(scroller.querySelectorAll<HTMLElement>('[data-calendar-row]')).find(row=>{const rect=row.getBoundingClientRect();return point.y>=rect.top && point.y<rect.bottom;});
    const valid=!!row && point.x>=bounds.left+100 && point.x<=bounds.right && point.y>=bounds.top && point.y<=bounds.bottom;
    const offset=Math.round((point.x-current.x+scroller.scrollLeft-current.scroll)/DAY_WIDTH);
    const checkIn=shiftDate(current.reservation.checkIn,offset), roomId=row?.dataset.calendarRow || current.roomId;
    if (checkIn!==current.checkIn || roomId!==current.roomId || valid!==current.valid) publish({...current,checkIn,roomId,valid});
  };
  useEffect(()=>{
    if (!drag || drag.keyboard) return;
    let frame=0;
    const tick=()=>{
      const el=scroll.current, point=pointer.current;
      if (el && point) {
        const rect=el.getBoundingClientRect();
        if (point.y>=rect.top && point.y<=rect.bottom) {
          if (point.y>rect.bottom-32) el.scrollTop+=6;
          else if (point.y<rect.top+80) el.scrollTop-=6;
          if (point.x>rect.right-38) el.scrollLeft+=8;
          else if (point.x<rect.left+138) el.scrollLeft-=8;
        }
        hit();
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    const escape=(event: globalThis.KeyboardEvent)=>{if(event.key==='Escape'){publish(null);pointer.current=null;}};
    window.addEventListener('keydown',escape);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('keydown',escape);};
  // One animation loop reads current refs throughout the gesture.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[!!drag,drag?.keyboard]);
  const start = (event: PointerEvent<HTMLButtonElement>, reservation: ReservaHotel) => {
    if (!canMove || event.button!==0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current={x:event.clientX,y:event.clientY};
    publish({reservation,roomId:reservation.habitacionId,checkIn:reservation.checkIn,x:event.clientX,scroll:scroll.current?.scrollLeft||0,valid:true,keyboard:false});
  };
  const finish = () => {
    const current=dragRef.current;
    publish(null); pointer.current=null;
    if (current?.valid && (current.roomId!==current.reservation.habitacionId || current.checkIn!==current.reservation.checkIn)) onMove(current);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, reservation: ReservaHotel) => {
    if (!canMove) return;
    let current=dragRef.current;
    if (!current && [' ','Enter'].includes(event.key)) {
      event.preventDefault();publish({reservation,roomId:reservation.habitacionId,checkIn:reservation.checkIn,x:0,scroll:0,valid:true,keyboard:true});return;
    }
    if (!current?.keyboard || current.reservation.id!==reservation.id) return;
    if (event.key==='Escape') { event.preventDefault();publish(null);return; }
    if (['Enter',' '].includes(event.key)) { event.preventDefault();finish();return; }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.key==='ArrowLeft' || event.key==='ArrowRight') current={...current,checkIn:shiftDate(current.checkIn,event.key==='ArrowLeft'?-1:1)};
    else {const index=rooms.findIndex(r=>r.id===current!.roomId);current={...current,roomId:rooms[Math.max(0,Math.min(rooms.length-1,index+(event.key==='ArrowUp'?-1:1)))].id};}
    publish(current);
  };
  const position = (checkIn: string, checkOut: string) => {
    const start=Math.max(0,distance(checkIn,first)), end=Math.min(days.length,distance(checkOut,first));
    return end>start ? {left:start*DAY_WIDTH+2,width:(end-start)*DAY_WIDTH-4} : null;
  };
  return <div className="min-w-0">
    <p id="calendar-help" className="p-3 text-xs text-muted-foreground">{canMove ? 'Arrastra el asa de una reserva azul con el mouse o el dedo. Desliza el resto del calendario para recorrerlo. Con teclado: espacio, flechas y Enter; Escape cancela. Se conservan las noches y el precio acordado.' : 'Selecciona una reserva para consultar sus datos.'}</p>
    <p role="status" aria-live="polite" className="px-3 pb-2 text-sm">{drag ? `${drag.valid?'Mover a':'Fuera del calendario'}: habitación ${rooms.find(r=>r.id===drag.roomId)?.numero} · ${drag.checkIn} → ${shiftDate(drag.checkIn,drag.reservation.noches)}` : 'Las reservas con check-in o finalizadas no se pueden arrastrar.'}</p>
    <div ref={scroll} className="max-w-full overflow-auto overscroll-x-contain" style={{maxHeight:480}} data-testid="reservation-calendar">
      <div style={{width:100+days.length*DAY_WIDTH}}>
        <div className="sticky top-0 z-30 flex h-12 bg-card border-b">
          <div className="sticky left-0 z-30 flex w-[100px] shrink-0 items-center bg-card px-2 text-xs font-semibold">Habitación</div>
          {days.map(day=><div key={calendarDate(day)} style={{width:DAY_WIDTH}} className={`shrink-0 p-2 text-center text-xs ${calendarDate(day)===calendarDate(new Date())?'font-bold text-orange-600':''}`}>{day.toLocaleDateString('es-CO',{weekday:'short',day:'numeric',month:'short'})}</div>)}
        </div>
        {rooms.map(room=><div key={room.id} data-calendar-row={room.id} className="relative flex h-16 border-b">
          <div className="sticky left-0 z-20 flex w-[100px] shrink-0 flex-col justify-center border-r bg-card px-2 text-xs"><strong>Hab. {room.numero}</strong><span className="text-muted-foreground">Piso {room.piso}</span></div>
          <div className="relative flex-1" style={{backgroundImage:'linear-gradient(to right, var(--border) 1px, transparent 1px)',backgroundSize:`${DAY_WIDTH}px 100%`}}>
            {reservations.filter(r=>r.habitacionId===room.id && r.estado!=='cancelada').sort((a,b)=>Number(a.estado!=='checkout')-Number(b.estado!=='checkout')).map(reservation=>{
              const style=position(reservation.checkIn,reservation.checkOut);
              if(!style)return null;
              return <div key={reservation.id} style={style} className={`absolute top-2 flex h-12 items-center rounded-lg text-white shadow-sm ${colors[reservation.estado]} ${drag?.reservation.id===reservation.id?'opacity-40':''}`}>
                {canMove && reservation.estado==='confirmada' && <button type="button" aria-label={`Mover reserva de ${reservation.huesped}`} aria-describedby="calendar-help" aria-pressed={drag?.reservation.id===reservation.id} className="flex h-12 w-11 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-l-lg bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:cursor-grabbing" onPointerDown={event=>start(event,reservation)} onPointerMove={event=>{if(dragRef.current&&!dragRef.current.keyboard){pointer.current={x:event.clientX,y:event.clientY};hit();}}} onPointerUp={event=>{if(dragRef.current&&!dragRef.current.keyboard){pointer.current={x:event.clientX,y:event.clientY};hit();finish();event.currentTarget.releasePointerCapture(event.pointerId);}}} onPointerCancel={()=>{publish(null);pointer.current=null;}} onLostPointerCapture={()=>{if(dragRef.current&&!dragRef.current.keyboard){publish(null);pointer.current=null;}}} onKeyDown={event=>keyboard(event,reservation)}><GripVertical size={20}/></button>}
                <button type="button" onClick={()=>{if(!dragRef.current)onSelect(reservation);}} className="h-12 min-w-0 flex-1 truncate px-2 text-left text-xs font-semibold" title={`${reservation.huesped} · ${reservation.checkIn} → ${reservation.checkOut}`}>{reservation.huesped}</button>
              </div>;
            })}
            {drag && drag.roomId===room.id && (()=>{const style=position(drag.checkIn,shiftDate(drag.checkIn,drag.reservation.noches));return style?<div style={style} className="pointer-events-none absolute top-1 z-10 h-14 rounded-lg border-2 border-dashed border-orange-600 bg-orange-200/60"/>:null;})()}
          </div>
        </div>)}
      </div>
    </div>
  </div>;
}
