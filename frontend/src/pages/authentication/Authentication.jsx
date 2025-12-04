import React, { useState } from 'react';
import {
  Tabs,
  Form,
  Input,
  Button,
  Card,
  Typography,
  Alert,
  Checkbox,
  Divider,
  Select
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  IdcardOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

const Authentication = () => {
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  
  const API_URL = import.meta.env.PROD ? import.meta.env.VITE_API_PROD_URL : import.meta.env.VITE_API_DEV_URL;

  const onLoginFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      console.log('Login values:', values);

      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: values.email,
          password: values.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ');
      }

      setLoading(false);
      setSuccess('เข้าสู่ระบบสำเร็จ!');

      Cookies.set('accessToken', data.accessToken, { expires: 15/1440 });
      Cookies.set('refreshToken', data.refreshToken, { expires: 7 });
      Cookies.set('user', JSON.stringify(data.user), { expires: 7 });

      setTimeout(() => {
        navigate('/dashboard');
      }, 1500);

    } catch (err) {
      setLoading(false);
      setError(err.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่');
    }
  };

  const onRegisterFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      console.log('Register values:', values);

      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: values.email,
          studentId: values.studentId,
          title: values.title,
          firstName: values.firstName,
          lastName: values.lastName,
          password: values.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'เกิดข้อผิดพลาดในการสมัครสมาชิก');
      }

      setLoading(false);
      setSuccess('สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ');

      setTimeout(() => {
        setActiveTab('login');
        setSuccess('');
      }, 2000);

    } catch (err) {
      setLoading(false);
      setError(err.message || 'เกิดข้อผิดพลาดในการสมัครสมาชิก กรุณาลองใหม่');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px',
      zIndex: 1000,
      overflow: 'auto'
    }}>
      <Card
        style={{
          width: '100%',
          maxWidth: 450,
          boxShadow: '0 15px 35px rgba(50,50,93,.1), 0 5px 15px rgba(0,0,0,.07)'
        }}
        bodyStyle={{ padding: '30px' }}
      >
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{ marginBottom: '20px' }}>
            <img
              src="/cqc.png"
              alt="CQC Logo"
              style={{
                maxWidth: '120px',
                height: 'auto',
                marginBottom: '10px'
              }}
            />
          </div>
          <Title level={2} style={{ color: '#1890ff', marginBottom: '10px' }}>
            CQC Portal
          </Title>
          <Text type="secondary">ระบบตรวจสอบและประมวลคำสั่งเอสคิวแอล</Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: '20px' }}
            closable
            onClose={() => setError('')}
          />
        )}

        {success && (
          <Alert
            message={success}
            type="success"
            showIcon
            style={{ marginBottom: '20px' }}
            closable
            onClose={() => setSuccess('')}
          />
        )}

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          centered
          size="large"
        >
          <TabPane tab="เข้าสู่ระบบ" key="login">
            <Form
              name="login"
              onFinish={onLoginFinish}
              layout="vertical"
              size="large"
            >
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: 'กรุณากรอกอีเมล' },
                  { type: 'email', message: 'รูปแบบอีเมลไม่ถูกต้อง!' },
                  { pattern: /^[^@]+@rmuti\.ac\.th$/, message: 'ต้องเป็น @rmuti.ac.th เท่านั้น' }
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder="อีเมล"
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[
                  { required: true, message: 'กรุณากรอกรหัสผ่าน!' },
                  { min: 6, message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' }
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="รหัสผ่าน"
                />
              </Form.Item>

              <Form.Item>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Checkbox>จำฉันไว้</Checkbox>
                  <Button type="link" style={{ padding: 0 }}>
                    ลืมรหัสผ่าน?
                  </Button>
                </div>
              </Form.Item>

              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                  style={{ height: '45px', fontSize: '16px' }}
                >
                  เข้าสู่ระบบ
                </Button>
              </Form.Item>
            </Form>
          </TabPane>

          <TabPane tab="สมัครสมาชิก" key="register">
            <Form
              name="register"
              onFinish={onRegisterFinish}
              layout="vertical"
              size="large"
            >
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: 'กรุณากรอกอีเมล!' },
                  { type: 'email', message: 'รูปแบบอีเมลไม่ถูกต้อง!' },
                  { pattern: /^[^@]+@rmuti\.ac\.th$/, message: 'ต้องเป็น @rmuti.ac.th เท่านั้น' }
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder="อีเมล"
                />
              </Form.Item>

              <Form.Item
                name="studentId"
                rules={[
                  { required: true, message: 'กรุณากรอกรหัสนักศึกษา!' },
                  { pattern: /^[0-9]{10}$/, message: 'รหัสนักศึกษาต้องมี 10 หลัก!' }
                ]}
              >
                <Input
                  prefix={<IdcardOutlined />}
                  placeholder="รหัสนักศึกษา"
                />
              </Form.Item>

              <Form.Item
                name="title"
                rules={[
                  { required: true, message: 'กรุณาเลือกคำนำหน้า!' }
                ]}
              >
                <Select placeholder="คำนำหน้า">
                  <Select.Option value="นาย">นาย</Select.Option>
                  <Select.Option value="นาง">นาง</Select.Option>
                  <Select.Option value="นางสาว">นางสาว</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                name="firstName"
                rules={[
                  { required: true, message: 'กรุณากรอกชื่อ!' }
                ]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="ชื่อ"
                />
              </Form.Item>

              <Form.Item
                name="lastName"
                rules={[
                  { required: true, message: 'กรุณากรอกนามสกุล!' }
                ]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="นามสกุล"
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[
                  { required: true, message: 'กรุณากรอกรหัสผ่าน!' },
                  { min: 6, message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' }
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="รหัสผ่าน"
                />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                dependencies={['password']}
                rules={[
                  { required: true, message: 'กรุณายืนยันรหัสผ่าน!' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('รหัสผ่านไม่ตรงกัน!'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="ยืนยันรหัสผ่าน"
                />
              </Form.Item>

              <Form.Item
                name="agreement"
                valuePropName="checked"
                rules={[
                  {
                    validator: (_, value) =>
                      value ? Promise.resolve() : Promise.reject(new Error('กรุณายอมรับเงื่อนไขการใช้งาน')),
                  },
                ]}
              >
                <Checkbox>
                  ฉันยอมรับ <a href="#">เงื่อนไขการใช้งาน</a> และ <a href="#">นโยบายความเป็นส่วนตัว</a>
                </Checkbox>
              </Form.Item>

              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                  style={{ height: '45px', fontSize: '16px' }}
                >
                  สมัครสมาชิก
                </Button>
              </Form.Item>
            </Form>
          </TabPane>
        </Tabs>
      </Card>
    </div>
  );
};

export default Authentication;