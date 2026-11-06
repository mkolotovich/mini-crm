import { useEffect, useState } from 'react';
import { Form, Input, Modal, message } from 'antd';
import { createObject, updateObject } from '../lib/api';
import type { CrmObject } from '../types';

export function ObjectFormModal({
  open,
  object,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean;
  object: CrmObject | null;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<{ name: string; address: string }>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(object ? { name: object.name, address: object.address } : { name: '', address: '' });
  }, [open, object, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    const result = object ? await updateObject(object.id, values) : await createObject(values, userId);
    setSaving(false);
    if (result.error) {
      message.error(result.error);
      return;
    }
    message.success(object ? 'Объект обновлён' : 'Объект создан');
    onClose();
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={object ? 'Правка объекта' : 'Новый объект'}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item label="Название" name="name" rules={[{ required: true, message: 'Нужно название' }]}>
          <Input maxLength={200} placeholder='ЖК "Северный", блок А' />
        </Form.Item>
        <Form.Item label="Адрес" name="address" rules={[{ required: true, message: 'Нужен адрес' }]}>
          <Input maxLength={300} placeholder="ул. Румянцева, 4" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
