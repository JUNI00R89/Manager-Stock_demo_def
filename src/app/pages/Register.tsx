import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Package, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';

export function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    setLoading(true);

    try {
      const success = await register(email, password, name);
      if (success) {
        toast.success('¡Cuenta creada exitosamente!');
        navigate('/business-setup', { replace: true });
      } else {
        toast.error('Error al crear la cuenta');
      }
    } catch (error) {
      toastError(error, 'No se pudo crear la cuenta. Verifica la conexión con el backend.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/60 bg-white/95 p-8 shadow-[0_30px_90px_rgba(15,23,42,.35)] backdrop-blur-xl">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-yellow-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <Package className="text-white" size={32} />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-yellow-600 bg-clip-text text-transparent mb-2">
              Manager Stock
            </h1>
            <p className="text-gray-600">Crear Nueva Cuenta</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre Completo</Label>
              <Input
                id="name"
                type="text"
                placeholder="Juan Pérez"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="border-orange-200 focus:border-orange-400 focus:ring-orange-400"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Correo Electrónico</Label>
              <Input
                id="email"
                type="email"
                placeholder="ejemplo@correo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="border-orange-200 focus:border-orange-400 focus:ring-orange-400"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 8 caracteres"
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="border-orange-200 focus:border-orange-400 focus:ring-orange-400"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Contraseña</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                className="border-orange-200 focus:border-orange-400 focus:ring-orange-400"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white font-semibold py-6"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 animate-spin" size={20} />
                  Creando cuenta...
                </>
              ) : (
                'Crear Cuenta'
              )}
            </Button>
          </form>

          {/* Login Link */}
          <div className="mt-6 text-center">
            <p className="text-gray-600">
              ¿Ya tienes una cuenta?{' '}
              <Link to="/login" className="text-orange-600 hover:text-orange-700 font-semibold">
                Inicia sesión
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
