import React from 'react';

export interface ThemeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  lightSrc: string;
  darkSrc: string;
  alt: string;
}

export function ThemeImage({ lightSrc, darkSrc, alt, className, ...rest }: ThemeImageProps) {
  const mergedClassName = className ? ` ${className}` : '';

  return (
    <>
      <img src={lightSrc} alt={alt} className={`theme-image-light${mergedClassName}`} {...rest} />
      <img src={darkSrc} alt={alt} className={`theme-image-dark${mergedClassName}`} {...rest} />
    </>
  );
}
