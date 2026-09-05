import React from 'react';

interface MaterialIconProps {
  name: string;
  className?: string;
  filled?: boolean;
  size?: number;
  id?: string;
}

export const MaterialIcon: React.FC<MaterialIconProps> = ({
  name,
  className = '',
  filled = false,
  size,
  id,
}) => {
  const style = size ? { fontSize: `${size}px` } : undefined;
  return (
    <span
      id={id}
      style={style}
      className={`material-symbols-outlined select-none inline-block ${
        filled ? 'material-symbols-filled' : ''
      } ${className}`}
    >
      {name}
    </span>
  );
};
