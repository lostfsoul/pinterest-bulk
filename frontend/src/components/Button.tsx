interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({ variant = 'primary', size = 'md', children, className = '', ...props }: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-mono font-bold uppercase text-sm transition-transform hover:translate-x-[-2px] hover:translate-y-[-2px] active:translate-x-0 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0';

  const variants = {
    primary: 'bg-accent text-white border-2 border-black shadow-brutal-sm hover:shadow-brutal',
    secondary: 'bg-white text-black border-2 border-black shadow-brutal-sm hover:shadow-brutal',
    danger: 'bg-red-600 text-white border-2 border-black shadow-brutal-sm hover:shadow-brutal',
    ghost: 'bg-transparent text-black border-2 border-black shadow-brutal-sm hover:shadow-brutal',
  };

  const sizes = {
    sm: 'px-3 py-1.5',
    md: 'px-4 py-2',
    lg: 'px-6 py-3',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
