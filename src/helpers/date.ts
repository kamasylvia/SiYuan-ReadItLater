import dayjs from 'dayjs';

export function formatCurrentDate(format: string): string {
    return formatDate(new Date(), format);
}

export function formatDate(date: Date | string, format: string): string {
    return dayjs(date).format(format);
}
