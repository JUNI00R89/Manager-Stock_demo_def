import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listCustomers, saveCustomer, emptyCustomer, type Customer } from '../services/commerce';
import { canPerformAction } from '../security/permissions';
import { useAuth } from '../context/AuthContext';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { toastError } from '../utils/notifications';

export function CustomerPicker({
  value,
  onChange,
}: {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
}) {
  const { user } = useAuth();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canRead = canPerformAction(user, 'customers.view');
  useEffect(() => {
    let active = true;
    if (!canRead || value || term.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void listCustomers(term)
        .then(list => {
          if (active) {
            setResults(list.slice(0, 8));
            setError('');
          }
        })
        .catch(e => {
          if (active) setError(e.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [term, value, canRead]);
  if (!canRead) return null;
  if (value)
    return (
      <div className="rounded-lg border p-3 text-sm space-y-2">
        <p className="font-medium break-words">{value.name}</p>
        <p>
          {value.documentType} {value.documentNumber || 'Sin documento'}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            onChange(null);
            setTerm('');
          }}
        >
          Cambiar cliente
        </Button>
      </div>
    );
  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        Cliente registrado
        <Input
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder="Nombre, teléfono o documento"
          className="min-h-11 mt-1"
        />
      </label>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {results.map(c => (
        <button
          type="button"
          key={c.id}
          className="block w-full text-left border rounded-lg p-3 hover:bg-accent break-words"
          onClick={() => onChange(c)}
        >
          {c.name}
          <span className="block text-xs text-muted-foreground">
            {c.documentType} {c.documentNumber} · {c.phone}
          </span>
        </button>
      ))}
      {term.trim().length >= 2 && canPerformAction(user, 'customers.manage') && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          className="min-h-11 w-full whitespace-normal"
          onClick={async () => {
            setBusy(true);
            try {
              const c = await saveCustomer({ ...emptyCustomer, name: term });
              onChange(c);
            } catch (e) {
              toastError(e, 'No se pudo crear el cliente.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Crear «{term}» como cliente
        </Button>
      )}
      <Link to="/customers" className="inline-block py-2 underline">
        Administrar datos de clientes
      </Link>
    </div>
  );
}
